import { FileData, GitHubRepo } from '../types';

const GITHUB_API_BASE = 'https://api.github.com';

interface GitBlob {
  sha: string;
  path: string;
  mode: string;
  type: string;
}

// Helper to encode array buffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export const validateToken = async (token: string): Promise<string | null> => {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.login; // Return username
  } catch (e) {
    return null;
  }
};

export const getUserRepos = async (token: string): Promise<GitHubRepo[]> => {
  try {
    // Fetch up to 100 recently updated repos
    const response = await fetch(`${GITHUB_API_BASE}/user/repos?sort=updated&per_page=100`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (!response.ok) return [];
    return await response.json();
  } catch (e) {
    console.error("Error fetching repos:", e);
    return [];
  }
};

export const checkRepoExists = async (token: string, owner: string, repo: string): Promise<boolean> => {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: { Authorization: `token ${token}` },
  });
  return response.status === 200;
};

export const createRepo = async (token: string, name: string, isPrivate: boolean): Promise<boolean> => {
  const response = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      private: isPrivate,
      auto_init: true, // Initialize so we have a main branch
    }),
  });
  return response.ok;
};

// Core logic: Push files using Git Database API
export const pushFilesToGitHub = async (
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: FileData[],
  commitMessage: string,
  onProgress: (msg: string) => void
): Promise<void> => {
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // 1. Get reference to current head (ONLY to get the parent commit SHA)
  onProgress('Fetching repository status...');
  let latestCommitSha: string | null = null;
  
  try {
    const refRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${branch}`, { headers });
    if (refRes.ok) {
      const refData = await refRes.json();
      latestCommitSha = refData.object.sha;
    } else {
      onProgress('Branch not found. Starting fresh commit tree.');
    }
  } catch (e) {
    console.warn('Could not fetch refs, assuming empty repo.');
  }

  // 2. Create Blobs for each file
  const treeItems: { path: string; mode: string; type: string; sha: string | null }[] = [];
  
  // Parallelize uploads in chunks
  const CHUNK_SIZE = 5;
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    const chunk = files.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(async (file) => {
      onProgress(`Uploading ${file.path}...`);
      
      let content: string;
      let encoding: 'utf-8' | 'base64';

      if (file.isBinary && file.content instanceof ArrayBuffer) {
        content = arrayBufferToBase64(file.content);
        encoding = 'base64';
      } else {
        content = file.content as string;
        encoding = 'utf-8';
      }

      try {
        const blobRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ content, encoding }),
        });
        
        if (!blobRes.ok) throw new Error(`Failed to upload ${file.path}`);
        
        const blobData = await blobRes.json();
        treeItems.push({
          path: file.path,
          mode: '100644', 
          type: 'blob',
          sha: blobData.sha,
        });
      } catch (e) {
        onProgress(`Error uploading ${file.path}: ${e}`);
        throw e;
      }
    }));
  }

  // 3. Create a Tree
  onProgress('Building file tree...');
  
  const treePayload: any = {
    tree: treeItems,
  };

  // To keep existing files and only ADD new ones, we MUST provide base_tree
  if (latestCommitSha) {
    try {
      const commitRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
      if (commitRes.ok) {
        const commitData = await commitRes.json();
        treePayload.base_tree = commitData.tree.sha;
      }
    } catch (e) {
      console.warn('Failed to fetch base tree, continuing with partial replacement');
    }
  }

  const treeRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify(treePayload),
  });
  
  if (!treeRes.ok) {
      const err = await treeRes.text();
      throw new Error(`Failed to create tree: ${err}`);
  }
  const treeData = await treeRes.json();
  const newTreeSha = treeData.sha;

  // 4. Create Commit
  onProgress('Finalizing commit...');
  const commitPayload: any = {
    message: commitMessage,
    tree: newTreeSha,
  };
  
  if (latestCommitSha) {
    commitPayload.parents = [latestCommitSha];
  }

  const newCommitRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify(commitPayload),
  });

  if (!newCommitRes.ok) throw new Error('Failed to create commit');
  const newCommitData = await newCommitRes.json();
  const newCommitSha = newCommitData.sha;

  // 5. Update Reference (The actual "Push")
  onProgress('Pushing to branch...');
  
  const refUrl = latestCommitSha 
    ? `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${branch}`
    : `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`;
  
  const method = latestCommitSha ? 'PATCH' : 'POST';
  const body = latestCommitSha 
    ? { sha: newCommitSha }
    : { ref: `refs/heads/${branch}`, sha: newCommitSha };

  const finalRes = await fetch(refUrl, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  if (!finalRes.ok) throw new Error('Failed to update branch reference');
  onProgress('Push complete!');
};

export const pushFilesCollaboratively = async (
  tokens: string[],
  owner: string,
  repo: string,
  branch: string,
  files: FileData[],
  onProgress: (msg: string) => void
): Promise<void> => {
  if (tokens.length < 2) throw new Error('Need at least two tokens for collaborative mode');
  
  onProgress(`🚀 Starting multi-user project push (7-stage Simulation)`);
  
  // Split files into ~7 batches to make the history look realistic
  const numChunks = Math.min(files.length, 7);
  const chunks: FileData[][] = [];
  const chunkSize = Math.ceil(files.length / 7);
  
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }

  const messages = [
    "Project foundation and configuration",
    "Implementation of core services and logic",
    "Developing reusable UI components",
    "Integrating application state and hooks",
    "Refactoring and performance optimization",
    "Advanced styling and layout enhancements",
    "Final integration and README documentation"
  ];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.length === 0) continue;
    
    // Toggle between users
    const activeToken = tokens[i % tokens.length];
    const userLabel = `User ${(i % tokens.length) + 1}`;
    const commitMsg = messages[i] || `Update system components (Stage ${i + 1})`;

    onProgress(`👤 ${userLabel} pushing ${chunk.length} files: ${commitMsg}`);
    
    try {
      await pushFilesToGitHub(
        activeToken,
        owner,
        repo,
        branch,
        chunk,
        commitMsg,
        (msg) => onProgress(`   ↳ ${msg}`)
      );
      onProgress(`✅ Stage ${i + 1}/${chunks.length} complete.`);
      
      // Pause to simulate real human activity
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    } catch (err) {
      onProgress(`❌ Error in Stage ${i + 1}: ${err}`);
      throw err;
    }
  }

  onProgress('✨ Collaboration simulation finished! Project structure preserved.');
};
