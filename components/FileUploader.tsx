import React, { useRef, useState } from 'react';
import { FileData } from '../types';

interface FileUploaderProps {
  onFilesSelected: (files: FileData[]) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFilesSelected }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsProcessing(true);
      const files: FileData[] = [];
      // Explicitly cast to File[] to fix 'unknown' type inference error
      const fileList = Array.from(e.target.files) as File[];

      // Process files
      for (const file of fileList) {
        // webkitRelativePath is available when uploading directories
        // Example: "MyProject/src/index.js"
        const rawPath = file.webkitRelativePath || file.name;
        
        // We want to strip the top-level folder name so that the CONTENTS of the selected folder
        // become the ROOT of the GitHub repository.
        // Example transformation: "MyProject/src/index.js" -> "src/index.js"
        const pathParts = rawPath.split('/');
        let relativePath = rawPath;
        
        if (pathParts.length > 1) {
            relativePath = pathParts.slice(1).join('/');
        }

        // Exclude node_modules and .git folders/files
        if (
             relativePath.includes('node_modules') || 
             relativePath.includes('.git/') || 
             relativePath.startsWith('.git/') ||
             relativePath === '.git'
        ) {
          continue;
        }

        // Skip if relativePath became empty (e.g. if the file was just the folder handle itself, though unlikely in File API)
        if (!relativePath) continue;

        const isBinary = isBinaryFile(file.name);
        try {
          const content = await readFileContent(file, isBinary);

          files.push({
            path: relativePath, // Preserves folder structure (minus root)
            content,
            isBinary,
            size: file.size,
          });
        } catch (err) {
          console.warn(`Skipping file ${file.name}:`, err);
        }
      }

      onFilesSelected(files);
      setIsProcessing(false);
    }
  };

  const isBinaryFile = (fileName: string): boolean => {
    const extensions = ['png', 'jpg', 'jpeg', 'gif', 'ico', 'pdf', 'zip', 'exe', 'bin', 'mp4', 'mp3', 'woff', 'woff2', 'ttf', 'eot', 'svg', 'mov', 'webm'];
    const ext = fileName.split('.').pop()?.toLowerCase();
    return ext ? extensions.includes(ext) : false;
  };

  const readFileContent = (file: File, isBinary: boolean): Promise<string | ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) resolve(e.target.result);
        else reject(new Error("Empty file"));
      };
      reader.onerror = (e) => reject(e);
      
      if (isBinary) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  return (
    <div className="w-full flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-700 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors">
      <div className="mb-4 text-6xl">📂</div>
      <h3 className="text-xl font-semibold mb-2 text-slate-200">Select Project Folder</h3>
      <p className="text-slate-400 text-center mb-6 max-w-md">
        Click to select a directory. The <strong>contents</strong> of the folder will be pushed to the root of your repository.
        <br/><span className="text-xs text-yellow-500/80">(node_modules and .git are automatically ignored)</span>
      </p>

      {isProcessing ? (
        <div className="flex items-center text-blue-400">
          <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Processing files...
        </div>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-8 rounded-lg shadow-lg shadow-blue-500/30 transition-all transform hover:scale-105"
        >
          Browse Folder
        </button>
      )}

      {/* 
        IMPORTANT: webkitdirectory attribute is non-standard but needed for folder selection.
        React TS doesn't natively support it on input types without module augmentation or casting.
      */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as any)} 
      />
    </div>
  );
};
