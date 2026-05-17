const VERCEL_API = 'https://api.vercel.com';

interface DeployResult {
  name: string;
  url: string;
  dashboardUrl: string;
}

export const deployToVercel = async (
  vercelToken: string,
  githubRepo: string, // "owner/repo"
  projectName: string,
  onLog: (msg: string) => void
): Promise<DeployResult> => {
  const headers = {
    Authorization: `Bearer ${vercelToken}`,
    'Content-Type': 'application/json',
  };

  onLog('Authenticating with Vercel...');

  // 1. Create or Get Project
  // We attempt to create a project linked to the GitHub repo.
  // If it exists, we catch the 409 Conflict and fetch the existing one.
  
  onLog(`Configuring Vercel project "${projectName}"...`);
  
  // Clean project name (Vercel requires lowercase, max 100 chars, etc.)
  const cleanName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 100);

  const createBody = {
    name: cleanName,
    gitRepository: {
      type: 'github',
      repo: githubRepo,
    },
    framework: null // Let Vercel auto-detect (Next.js, CRA, etc.)
  };

  let projectData: any;

  try {
    const createRes = await fetch(`${VERCEL_API}/v9/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify(createBody),
    });

    if (createRes.status === 409) {
      onLog('Project already exists on Vercel. Fetching details...');
      const getRes = await fetch(`${VERCEL_API}/v9/projects/${cleanName}`, { headers });
      if (!getRes.ok) throw new Error('Failed to fetch existing Vercel project.');
      projectData = await getRes.json();
      
      // Check if linked to the correct repo
      const linkedRepo = projectData.link?.repo;
      if (linkedRepo && linkedRepo !== githubRepo) {
        onLog(`Warning: This Vercel project is currently linked to "${linkedRepo}", not "${githubRepo}".`);
      } else if (!projectData.link) {
         onLog('Warning: Existing project is not linked to a git repository.');
      } else {
         onLog('Confirmed existing project link.');
      }
    } else if (!createRes.ok) {
      const err = await createRes.json();
      // Handle "missing_github_app" error specifically
      if (err.error?.code === 'missing_github_app' || err.code === 'missing_github_app') {
        throw new Error('Vercel does not have access to this GitHub repository. Please install the "Vercel" GitHub App on your account/org settings first.');
      }
      throw new Error(`Vercel API Error: ${err.error?.message || err.message || createRes.statusText}`);
    } else {
      projectData = await createRes.json();
      onLog('Vercel project created and linked to GitHub.');
    }

    onLog('Triggering deployment via GitHub integration...');
    
    // Note: Creating the project or updating the repo usually triggers a deployment automatically 
    // if the Vercel GitHub App is installed. We don't need to manually trigger a build 
    // unless we want to force it, but that requires different endpoints.
    // We return the expected URL.

    return {
      name: projectData.name,
      url: `https://${projectData.name}.vercel.app`,
      dashboardUrl: `https://vercel.com/${projectData.accountId}/${projectData.name}`
    };

  } catch (error) {
    console.error("Vercel Service Error:", error);
    throw error;
  }
};
