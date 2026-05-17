import React, { useState, useEffect } from 'react';
import { StepIndicator } from './components/StepIndicator';
import { FileUploader } from './components/FileUploader';
import { FileData, UploadStatus, ProcessingLog, GitHubRepo } from './types';
import * as githubService from './services/githubService';
import * as vercelService from './services/vercelService';

export default function App() {
  const [step, setStep] = useState(1);
  
  // State: Auth
  const [token, setToken] = useState('');
  const [username, setUsername] = useState<string | null>(null);
  const [token2, setToken2] = useState('');
  const [username2, setUsername2] = useState<string | null>(null);
  const [isTeacherMode, setIsTeacherMode] = useState(false);
  
  // State: Repo
  const [repoMode, setRepoMode] = useState<'create' | 'existing'>('create');
  const [userRepos, setUserRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [searchRepo, setSearchRepo] = useState('');

  const [repoName, setRepoName] = useState('');
  const [repoOwner, setRepoOwner] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [branch, setBranch] = useState('main');
  
  // State: Files
  const [files, setFiles] = useState<FileData[]>([]);
  
  // State: Commit & Push
  const [commitMessage, setCommitMessage] = useState('');
  const [status, setStatus] = useState<UploadStatus>(UploadStatus.IDLE);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);

  // State: Vercel
  const [vercelToken, setVercelToken] = useState('');
  const [deployResult, setDeployResult] = useState<{name: string, url: string, dashboardUrl: string} | null>(null);

  const addLog = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, { message: msg, type, timestamp: Date.now() }]);
  };

  // Fetch repos when entering Step 2
  useEffect(() => {
    if (step === 2 && token && userRepos.length === 0) {
      loadRepos();
    }
  }, [step, token]);

  const loadRepos = async () => {
    setIsLoadingRepos(true);
    const repos = await githubService.getUserRepos(token);
    setUserRepos(repos);
    setIsLoadingRepos(false);
  };

  // --- Step 1: Auth ---
  const handleTokenSubmit = async () => {
    if (!token) return;
    setStatus(UploadStatus.READING);
    
    const user1 = await githubService.validateToken(token);
    if (!user1) {
      alert("Invalid primary GitHub Token");
      setStatus(UploadStatus.IDLE);
      return;
    }

    setUsername(user1);
    setRepoOwner(user1);

    if (isTeacherMode) {
      if (!token2) {
        alert("Please enter both tokens for Collaborative Mode");
        setStatus(UploadStatus.IDLE);
        return;
      }
      const user2 = await githubService.validateToken(token2);
      if (!user2) {
        alert("Invalid secondary GitHub Token");
        setStatus(UploadStatus.IDLE);
        return;
      }
      setUsername2(user2);
    }

    setStep(2);
    setStatus(UploadStatus.IDLE);
  };

  // --- Step 2: Repo ---
  const handleRepoSubmit = async () => {
    if (!repoName || !repoOwner) return;
    setStatus(UploadStatus.READING);
    
    // Check if repo exists
    const exists = await githubService.checkRepoExists(token, repoOwner, repoName);
    
    if (exists) {
      // It exists, we will push to it
      addLog(`Repository ${repoOwner}/${repoName} found.`, 'success');
      setStep(3);
    } else {
      // Create it (only if in create mode or implicit)
      if (repoMode === 'existing') {
        addLog(`Repository ${repoOwner}/${repoName} not found.`, 'error');
        setStatus(UploadStatus.IDLE);
        return;
      }

      try {
        addLog(`Creating repository ${repoName}...`, 'info');
        const created = await githubService.createRepo(token, repoName, isPrivate);
        if (created) {
          addLog(`Repository ${repoName} created successfully.`, 'success');
          setStep(3);
        } else {
          addLog("Failed to create repository", 'error');
        }
      } catch (e) {
        addLog("Error creating repository", 'error');
      }
    }
    setStatus(UploadStatus.IDLE);
  };

  const handleExistingRepoSelect = (repo: GitHubRepo) => {
    setRepoName(repo.name);
    setRepoOwner(repo.owner.login);
    setBranch(repo.default_branch);
    setIsPrivate(repo.private);
  };

  // --- Step 3: Files ---
  const handleFilesSelected = (selectedFiles: FileData[]) => {
    if (selectedFiles.length === 0) return;
    setFiles(selectedFiles);
    setCommitMessage(`feat: initial upload of ${selectedFiles.length} files`);
    setStep(4);
  };

  const handleRemoveFile = (indexToRemove: number) => {
    setFiles(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // --- Step 4: Push ---
  const handlePush = async () => {
    if (!repoOwner || !repoName || files.length === 0) return;
    setStatus(UploadStatus.UPLOADING);
    setLogs([]); // Clear previous logs
    
    try {
      addLog('Starting upload process...', 'info');
      
      if (isTeacherMode && token2) {
        setStatus(UploadStatus.SIMULATING);
        await githubService.pushFilesCollaboratively(
          [token, token2],
          repoOwner,
          repoName,
          branch,
          files,
          (msg) => addLog(msg, 'info')
        );
      } else {
        await githubService.pushFilesToGitHub(
          token,
          repoOwner,
          repoName,
          branch,
          files,
          commitMessage || "Update project files",
          (msg) => addLog(msg, 'info')
        );
      }
      
      setStatus(UploadStatus.SUCCESS);
      addLog('Project pushed successfully!', 'success');
    } catch (error: any) {
      console.error(error);
      setStatus(UploadStatus.ERROR);
      addLog(`Error: ${error.message}`, 'error');
    }
  };

  // --- Step 5: Vercel Deploy ---
  const handleVercelDeploy = async () => {
    if (!vercelToken) {
      alert("Please enter a Vercel Access Token");
      return;
    }
    setStatus(UploadStatus.UPLOADING);
    setLogs([]); // Reset logs for deploy
    addLog("Initializing Vercel deployment...", 'info');

    // Simple framework detection
    let detectedFramework: string | null = null;
    const hasVite = files.some(f => f.path.toLowerCase().includes('vite.config'));
    const hasPackageJson = files.some(f => f.path === 'package.json');
    
    if (hasVite) {
      detectedFramework = 'vite';
      addLog("Detected Vite project structure.", 'info');
    } else if (hasPackageJson) {
      detectedFramework = 'other';
      addLog("Detected Node.js project.", 'info');
    }

    try {
      const result = await vercelService.deployToVercel(
        vercelToken,
        `${repoOwner}/${repoName}`,
        repoName,
        (msg) => addLog(msg, 'info'),
        detectedFramework
      );
      setDeployResult(result);
      setStatus(UploadStatus.SUCCESS);
      addLog("Vercel project linked successfully!", 'success');
      addLog(`Your app will be available at: ${result.url}`, 'success');
    } catch (error: any) {
      console.error(error);
      setStatus(UploadStatus.ERROR);
      addLog(`Deployment Error: ${error.message}`, 'error');
    }
  };

  const reset = () => {
    setFiles([]);
    setStep(2);
    setStatus(UploadStatus.IDLE);
    setLogs([]);
    setCommitMessage('');
    setDeployResult(null);
  };

  const filteredRepos = userRepos.filter(r => 
    r.full_name.toLowerCase().includes(searchRepo.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-5xl">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 mb-2">
            GitGenius Pusher
          </h1>
          <p className="text-slate-400">Push local folders to GitHub & Deploy to Vercel.</p>
        </header>

        <StepIndicator currentStep={step} />

        <div className="bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-8 min-h-[500px]">
          
          {/* STEP 1: AUTH */}
          {step === 1 && (
            <div className="flex flex-col gap-6 max-w-xl mx-auto mt-8">
              <div className="flex items-center justify-between p-4 bg-slate-900 rounded-lg border border-slate-700">
                <div>
                  <h4 className="font-bold text-white">Режим "Викладач" (Колаборація)</h4>
                  <p className="text-xs text-slate-400">Симуляція роботи команди: проект буде завантажено у 7 етапів з чергуванням двох авторів.</p>
                </div>
                <button 
                  onClick={() => setIsTeacherMode(!isTeacherMode)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isTeacherMode ? 'bg-blue-600' : 'bg-slate-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isTeacherMode ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-300">
                    {isTeacherMode ? 'Токен 1-го учасника' : 'GitHub Personal Access Token'}
                  </label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {isTeacherMode && (
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-300">Токен 2-го учасника</label>
                    <input
                      type="password"
                      value={token2}
                      onChange={(e) => setToken2(e.target.value)}
                      placeholder="ghp_yyyyyyyyyyyy"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                )}
              </div>

              {isTeacherMode && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <p className="text-[10px] text-amber-500 leading-tight">
                    Важливо: обидва акаунти повинні мати права на запис у репозиторій. 
                    Проект буде розділено на 7 логічних комітів для створення реалістичної історії розробки.
                  </p>
                </div>
              )}

              <p className="text-xs text-slate-500">
                Required scopes: <code>repo</code>, <code>user</code>. Tokens are handled client-side and never stored.
              </p>
              
              <button
                onClick={handleTokenSubmit}
                disabled={status === UploadStatus.READING}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors"
              >
                {status === UploadStatus.READING ? 'Verifying Tokens...' : 'Connect to GitHub'}
              </button>
            </div>
          )}

          {/* STEP 2: REPO DETAILS */}
          {step === 2 && (
            <div className="flex flex-col gap-6 max-w-md mx-auto mt-4">
              <div className="text-center mb-4 space-y-1">
                <p className="text-slate-400">Logged in as <span className="text-white font-bold">{username}</span></p>
                {isTeacherMode && username2 && (
                  <p className="text-slate-400">Collaborator: <span className="text-white font-bold">{username2}</span></p>
                )}
                {isTeacherMode && (
                  <p className="text-[10px] text-blue-400 bg-blue-400/10 py-1 px-2 rounded-full inline-block">Simulation: ACTIVE</p>
                )}
                {repoName && (
                  <div className="mt-2 text-xs">
                    <a 
                      href={`https://github.com/${repoOwner}/${repoName}`} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="text-blue-400 hover:underline flex items-center justify-center gap-1"
                    >
                      <span>🔗 github.com/{repoOwner}/{repoName}</span>
                    </a>
                  </div>
                )}
              </div>

              {/* Toggle Mode */}
              <div className="flex p-1 bg-slate-900 rounded-lg mb-4 border border-slate-700">
                <button 
                  onClick={() => { setRepoMode('create'); setRepoName(''); setRepoOwner(username!); }}
                  className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${
                    repoMode === 'create' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Create New
                </button>
                <button 
                   onClick={() => { setRepoMode('existing'); }}
                   className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${
                    repoMode === 'existing' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                   }`}
                >
                  Update Existing
                </button>
              </div>
              
              {repoMode === 'create' ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-300">New Repository Name</label>
                    <input
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="my-awesome-project"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-300">Branch</label>
                    <input
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="main"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-4 bg-slate-900 p-4 rounded-lg border border-slate-700">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} className="w-4 h-4 text-blue-500" />
                      <span>Private</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} className="w-4 h-4 text-blue-500" />
                      <span>Public</span>
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-300">Select Repository</label>
                    {isLoadingRepos ? (
                      <div className="text-slate-500 text-sm animate-pulse">Loading repositories...</div>
                    ) : (
                      <>
                        <input
                           type="text"
                           value={searchRepo}
                           onChange={(e) => setSearchRepo(e.target.value)}
                           placeholder="Filter repositories..."
                           className="w-full mb-2 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                        <div className="max-h-48 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg">
                           {filteredRepos.length === 0 ? (
                             <div className="p-3 text-sm text-slate-500 text-center">No repositories found</div>
                           ) : (
                             filteredRepos.map(repo => (
                               <div 
                                 key={repo.id}
                                 onClick={() => {
                                   handleExistingRepoSelect(repo);
                                   setSearchRepo(repo.full_name);
                                 }}
                                 className={`p-3 cursor-pointer text-sm hover:bg-slate-800 transition-colors flex justify-between items-center
                                   ${repoName === repo.name && repoOwner === repo.owner.login ? 'bg-blue-900/30 text-blue-300' : 'text-slate-300'}
                                 `}
                               >
                                 <span className="truncate pr-2">{repo.full_name}</span>
                                 {repo.private && <span className="text-xs bg-slate-800 border border-slate-600 px-1 rounded">Private</span>}
                               </div>
                             ))
                           )}
                        </div>
                      </>
                    )}
                  </div>
                  {repoName && (
                    <div className="space-y-2 bg-slate-900/50 p-3 rounded border border-slate-700/50">
                        <div className="text-xs text-slate-500">Target: <span className="text-slate-300">{repoOwner}/{repoName}</span></div>
                        <div className="flex items-center gap-2">
                             <label className="text-xs font-bold text-slate-400">Branch:</label>
                             <input 
                                type="text" 
                                value={branch} 
                                onChange={(e) => setBranch(e.target.value)}
                                className="bg-transparent border-b border-slate-600 text-sm text-white focus:border-blue-500 outline-none w-full"
                             />
                        </div>
                    </div>
                  )}
                </>
              )}

              <button
                onClick={handleRepoSubmit}
                disabled={!repoName || status === UploadStatus.READING}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-lg transition-colors mt-2"
              >
                {status === UploadStatus.READING ? 'Checking Repo...' : 'Next: Select Files'}
              </button>
            </div>
          )}

          {/* STEP 3: UPLOAD */}
          {step === 3 && (
            <div className="mt-8">
               <FileUploader onFilesSelected={handleFilesSelected} />
               <div className="mt-4 text-center">
                 <button onClick={() => setStep(2)} className="text-slate-400 hover:text-white underline text-sm">Back to Repo Settings</button>
               </div>
            </div>
          )}

          {/* STEP 4: REVIEW & PUSH */}
          {step === 4 && (
            <div className="flex flex-col lg:flex-row gap-8 h-full">
              {/* Left Col: File Summary */}
              <div className="flex-1 space-y-4">
                <div className="flex justify-between items-center">
                   <h3 className="text-xl font-bold text-white flex items-center">
                     <span className="mr-2">📄</span> {files.length} Files Ready
                   </h3>
                </div>

                <div className="bg-slate-900 rounded-lg p-2 h-96 overflow-y-auto border border-slate-700">
                  <ul className="space-y-1 text-sm text-slate-300">
                    {files.slice(0, 150).map((f, i) => (
                      <li key={i} className="flex justify-between items-center p-2 hover:bg-slate-800 rounded group">
                        <div className="flex items-center flex-1 truncate">
                          <span className="text-slate-500 mr-2">{f.isBinary ? '📦' : '📄'}</span>
                          <span className={`truncate ${f.path === 'README.md' ? 'text-orange-400 font-bold' : ''}`}>{f.path}</span>
                        </div>
                        <div className="flex items-center gap-3">
                           <span className="text-xs text-slate-600 whitespace-nowrap">{(f.size / 1024).toFixed(1)} KB</span>
                           <button 
                             onClick={() => handleRemoveFile(i)}
                             className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                             title="Remove file"
                           >
                             ✕
                           </button>
                        </div>
                      </li>
                    ))}
                    {files.length > 150 && (
                      <li className="text-center text-slate-500 italic pt-2">...and {files.length - 150} more</li>
                    )}
                  </ul>
                </div>
                <p className="text-xs text-slate-500 text-center">Hover over a file to remove it from the push.</p>
              </div>

              {/* Right Col: Commit Actions */}
              <div className="flex-1 space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-bold text-slate-300">Commit Message</label>
                  </div>
                  <textarea
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    className="w-full h-32 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono text-sm"
                    placeholder="feat: initial commit"
                  />
                </div>

                {status === UploadStatus.IDLE || status === UploadStatus.ERROR ? (
                   <button
                   onClick={handlePush}
                   className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 px-6 rounded-lg shadow-lg shadow-green-500/20 transition-all transform hover:scale-[1.02]"
                 >
                   🚀 {isTeacherMode ? 'Start Collaborative Simulation' : 'Push to GitHub'}
                 </button>
                ) : (
                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 h-40 overflow-y-auto">
                    {status === UploadStatus.SUCCESS ? (
                      <div className="flex flex-col items-center justify-center h-full text-green-400">
                         <span className="text-4xl mb-2">🎉</span>
                         <span className="font-bold">Push Complete!</span>
                         <a 
                            href={`https://github.com/${repoOwner}/${repoName}/tree/${branch}`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="mt-2 text-blue-400 hover:underline"
                          >
                            View Repository
                         </a>
                         <button 
                           onClick={() => {
                             setStatus(UploadStatus.IDLE);
                             setLogs([]);
                             setStep(5);
                           }} 
                           className="mt-6 bg-black text-white px-6 py-3 rounded-lg font-bold border border-slate-700 hover:bg-slate-900 transition-colors shadow-lg flex items-center"
                         >
                           <svg viewBox="0 0 1155 1000" className="w-4 h-4 mr-2 fill-white"><path d="M577.344 0L1154.69 1000H0L577.344 0Z" /></svg>
                           Deploy to Vercel
                         </button>
                         <button onClick={reset} className="mt-4 text-xs text-slate-500 hover:text-white underline">Or push another project</button>
                      </div>
                    ) : status === UploadStatus.SIMULATING ? (
                      <div className="flex flex-col items-center justify-center h-full text-blue-400">
                         <div className="relative w-12 h-12 mb-4">
                           <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                           <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                         </div>
                         <span className="font-bold animate-pulse text-lg">SIMULATING COLLABORATION...</span>
                         <p className="text-xs text-slate-500 mt-2">Checking in files one by one as different users.</p>
                         <div className="mt-4 w-full px-4 overflow-hidden">
                            <div className="font-mono text-[10px] space-y-1 opacity-60">
                              {logs.slice(-2).map((log, i) => (
                                <div key={i} className="truncate">» {log.message}</div>
                              ))}
                            </div>
                         </div>
                      </div>
                    ) : (
                      <div className="font-mono text-xs space-y-1">
                        {logs.map((log, i) => (
                          <div key={i} className={`${
                            log.type === 'error' ? 'text-red-400' : 
                            log.type === 'success' ? 'text-green-400' : 'text-slate-400'
                          }`}>
                            <span className="opacity-50">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.message}
                          </div>
                        ))}
                        <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth' })} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5: VERCEL DEPLOY */}
          {step === 5 && (
            <div className="max-w-md mx-auto mt-8 flex flex-col gap-6">
               <div className="text-center">
                  <h3 className="text-2xl font-bold text-white mb-2">Deploy to Vercel</h3>
                  <p className="text-slate-400 text-sm">
                    Link your GitHub repository to Vercel to enable continuous deployment.
                  </p>
                  {repoName && (
                    <div className="mt-3">
                      <a 
                        href={`https://github.com/${repoOwner}/${repoName}`} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-xs bg-slate-900 border border-slate-700 rounded-full px-3 py-1 text-slate-400 hover:text-white hover:border-slate-500 transition-all inline-flex items-center gap-1"
                      >
                        <span>🐙 github.com/{repoOwner}/{repoName}</span>
                      </a>
                    </div>
                  )}
               </div>

               <div className="space-y-2">
                 <label className="text-sm font-bold text-slate-300">Vercel Access Token</label>
                 <input
                   type="password"
                   value={vercelToken}
                   onChange={(e) => setVercelToken(e.target.value)}
                   placeholder="ex: regular-deployment-token"
                   className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-black outline-none"
                 />
                 <a href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">Get a token here</a>
               </div>

               {status === UploadStatus.IDLE || status === UploadStatus.ERROR ? (
                   <button
                   onClick={handleVercelDeploy}
                   className="w-full bg-white text-black hover:bg-slate-200 font-bold py-3 px-6 rounded-lg shadow-lg transition-all transform hover:scale-[1.02] flex justify-center items-center"
                 >
                   <svg viewBox="0 0 1155 1000" className="w-4 h-4 mr-2 fill-black"><path d="M577.344 0L1154.69 1000H0L577.344 0Z" /></svg>
                   Deploy Project
                 </button>
               ) : (
                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 h-64 overflow-y-auto overflow-x-hidden">
                    {status === UploadStatus.SUCCESS && deployResult ? (
                       <div className="flex flex-col items-center justify-center h-full text-center">
                         <span className="text-4xl mb-2">🚀</span>
                         <h4 className="font-bold text-white">Project Connected!</h4>
                         <p className="text-[10px] text-slate-500 max-w-[250px] mt-1 mb-3">Vercel will start building your project. It may take a minute to become active.</p>
                         <a href={deployResult.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline font-mono text-sm mb-2 truncate w-full px-2">{deployResult.url}</a>
                         <div className="flex gap-2">
                           <a href={deployResult.dashboardUrl} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-white border border-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">Vercel Dashboard</a>
                           <a href={`https://github.com/${repoOwner}/${repoName}`} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-white border border-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors">GitHub Repo</a>
                         </div>
                         <button onClick={reset} className="mt-6 text-xs text-slate-600 hover:text-slate-400">← Back to Projects</button>
                       </div>
                    ) : (
                      <div className="font-mono text-[10px] space-y-1">
                        {logs.map((log, i) => (
                           <div key={i} className={`${
                            log.type === 'error' ? 'text-red-400' : 
                            log.type === 'success' ? 'text-green-400' : 'text-slate-400'
                          }`}>
                            <span className="opacity-50">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
               )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
