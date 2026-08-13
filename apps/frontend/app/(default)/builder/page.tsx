'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/common/SidebarNav';
import { ResumeBuilder } from '@/components/builder/resume-builder';

export default function BuilderPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-white pl-16">
      <SidebarNav
        currentPage="builder"
        onNavigate={(page) => router.push(page)}
      />
      <ResumeBuilder />
    </div>
  );
}