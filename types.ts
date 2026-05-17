export interface FileData {
  path: string;
  content: string | ArrayBuffer;
  isBinary: boolean;
  size: number;
}

export enum UploadStatus {
  IDLE = 'IDLE',
  READING = 'READING',
  UPLOADING = 'UPLOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
  SIMULATING = 'SIMULATING',
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: {
    login: string;
  };
  html_url: string;
  description: string | null;
}

export interface VercelProject {
  id: string;
  name: string;
  targets: {
    production?: {
      url: string;
    }
  };
  link?: {
    type: string;
    repo: string;
  };
}

export interface ProcessingLog {
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
}
