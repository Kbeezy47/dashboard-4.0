
import React from 'react';

const GpuIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16v4m-2-2h4m2 10h-4m2 2v4m-2-2h4m-5-9h4v4h-4z" />
  </svg>
);

export default GpuIcon;
