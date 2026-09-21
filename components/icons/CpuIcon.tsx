
import React from 'react';

const CpuIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M12 6V3m0 18v-3m6-6h3m-3 6h3m-3-12h3m-3 6h3M9 6V3m0 18v-3m-6-6H3m-3 6H3m-3-12H3m-3 6H3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16 8a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

export default CpuIcon;
