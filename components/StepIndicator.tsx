import React from 'react';

interface StepIndicatorProps {
  currentStep: number;
}

const steps = ['Auth', 'Repo', 'Files', 'Push', 'Deploy'];

export const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep }) => {
  return (
    <div className="flex items-center justify-center w-full mb-8">
      {steps.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isCompleted = stepNum < currentStep;

        return (
          <div key={label} className="flex items-center">
            <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 font-bold transition-all duration-300
              ${isActive ? 'border-blue-500 text-blue-500 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 
                isCompleted ? 'border-green-500 text-green-500 bg-green-500/10' : 'border-slate-700 text-slate-500 bg-slate-800'
              }
            `}>
              {isCompleted ? '✓' : stepNum}
            </div>
            <span className={`ml-2 mr-6 text-sm font-medium ${isActive ? 'text-blue-400' : isCompleted ? 'text-green-400' : 'text-slate-600'}`}>
              {label}
            </span>
            {idx < steps.length - 1 && (
              <div className={`h-1 w-12 mr-4 rounded ${isCompleted ? 'bg-green-500/50' : 'bg-slate-800'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
};
