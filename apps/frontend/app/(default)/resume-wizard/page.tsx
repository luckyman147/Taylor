'use client';

import React from 'react';
import SidebarNav from '@/components/common/SidebarNav';
import { useRouter } from 'next/navigation';
import { ResumeWizardPage } from '@/components/resume-wizard/resume-wizard-page';
import { useTranslations } from '@/lib/i18n';

export default function Page() {
  const { t } = useTranslations();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-white pl-16">
      <SidebarNav
        currentPage="resume-wizard"
        onNavigate={(page) => router.push(page)}
      />
      <ResumeWizardPage />
    </div>
  );
}