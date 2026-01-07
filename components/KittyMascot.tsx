
import React from 'react';

const KittyMascot: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 200 200" className={className} xmlns="http://www.w3.org/2000/svg">
    <circle cx="100" cy="110" r="70" fill="#fbcfe8" />
    <path d="M50 70 L30 20 L80 50 Z" fill="#fbcfe8" />
    <path d="M150 70 L170 20 L120 50 Z" fill="#fbcfe8" />
    <circle cx="75" cy="100" r="8" fill="#4c1d95" />
    <circle cx="125" cy="100" r="8" fill="#4c1d95" />
    <path d="M90 120 Q100 135 110 120" stroke="#4c1d95" strokeWidth="4" fill="none" strokeLinecap="round" />
    <circle cx="100" cy="115" r="5" fill="#ec4899" />
    <path d="M100 125 L100 145" stroke="#4c1d95" strokeWidth="2" strokeDasharray="2,2" />
  </svg>
);

export default KittyMascot;
