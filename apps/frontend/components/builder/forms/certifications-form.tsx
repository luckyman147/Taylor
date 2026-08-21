'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Award, Plus, Trash2 } from 'lucide-react';
import { CareerCertification } from '@/lib/api/profile';
import { useTranslations } from '@/lib/i18n';
import { AddCertificationDialog } from '@/components/builder/add-certification-dialog';

interface CertificationsFormProps {
  data: string[];
  onChange: (data: string[]) => void;
}

/**
 * Format a profile certification into a single resume entry string.
 */
export function formatCertification(cert: CareerCertification): string {
  const parts = [cert.name];
  if (cert.issuer) parts.push(cert.issuer);
  if (cert.date_obtained) parts.push(cert.date_obtained.slice(0, 4));
  return parts.join(' — ');
}

export const CertificationsForm: React.FC<CertificationsFormProps> = ({ data, onChange }) => {
  const { t } = useTranslations();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const handleChange = (index: number, value: string) => {
    onChange(data.map((item, i) => (i === index ? value : item)));
  };

  const handleRemove = (index: number) => {
    onChange(data.filter((_, i) => i !== index));
  };

  const handleAddFromProfile = (cert: CareerCertification) => {
    onChange([...data, formatCertification(cert)]);
  };

  const handleAddManually = () => {
    onChange([...data, '']);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="rounded-lg border-ink hover:bg-primary hover:text-white transition-colors"
        >
          <Award className="w-4 h-4 mr-2" /> {t('builder.forms.certifications.addCertificate')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddManually}
          className="rounded-lg border-ink hover:bg-primary hover:text-white transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" /> {t('builder.forms.certifications.addManually')}
        </Button>
      </div>

      <div className="space-y-8">
        {data.length === 0 ? (
          <div className="text-center rounded-xl py-12 bg-paper-tint border border-dashed border-[#e6e3dc]">
            <p className="text-sm text-steel-grey">
              {t('builder.forms.certifications.noCertificates')}
            </p>
          </div>
        ) : (
          data.map((cert, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[#e6e3dc] bg-white relative group p-6"
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => handleRemove(idx)}
                aria-label={t('a11y.removeItem')}
                title={t('a11y.removeItem')}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <div className="space-y-2 pr-8">
                <Label className="text-xs uppercase tracking-wider text-steel-grey">
                  {t('builder.forms.certifications.fields.certificate')}
                </Label>
                <Input
                  value={cert}
                  onChange={(e) => handleChange(idx, e.target.value)}
                  placeholder={t('builder.forms.certifications.placeholders.certificate')}
                  className="rounded-lg border-ink bg-white"
                />
              </div>
            </div>
          ))
        )}
      </div>

      <AddCertificationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={handleAddFromProfile}
        existingNames={data.map((d) => d.split(' — ')[0] || d)}
      />
    </div>
  );
};