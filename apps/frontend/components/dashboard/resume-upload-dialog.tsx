'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  UploadIcon,
  Loader2Icon,
  AlertCircleIcon,
  FileIcon,
  XIcon,
  CheckCircle2Icon,
} from 'lucide-react';
import { useFileUpload, formatBytes } from '@/hooks/use-file-upload';
import { getUploadUrl } from '@/lib/api/client';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { retryProcessing } from '@/lib/api/resume';

interface ResumeUploadDialogProps {
  trigger?: React.ReactNode;
  onUploadComplete?: (resumeId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultAsMaster?: boolean;
}

const ACCEPTED_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
];
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB

export function ResumeUploadDialog({
  trigger,
  onUploadComplete,
  open: controlledOpen,
  onOpenChange,
  defaultAsMaster,
}: ResumeUploadDialogProps) {
  const { t } = useTranslations();
  const [internalOpen, setInternalOpen] = useState(false);
  const [asMaster, setAsMaster] = useState(() => defaultAsMaster ?? false);
  const [uploadFeedback, setUploadFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [failedResumeId, setFailedResumeId] = useState<string | null>(null);
  const [isRetryingProcessing, setIsRetryingProcessing] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = (nextOpen: boolean) => {
    if (!isControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  // The dashboard passes defaultAsMaster based on whether masters already
  // exist, which is usually known only AFTER the dialog is first mounted.
  // Re-sync the toggle from that prop each time the dialog opens so a
  // late-arriving "you already have masters" default isn't stuck at false.
  const wasOpenRef = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setAsMaster(defaultAsMaster ?? false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, defaultAsMaster]);

  const UPLOAD_URL = getUploadUrl(asMaster);

  const handleUploadSuccess = ({
    resumeId,
    fileId,
    message,
  }: {
    resumeId: string;
    fileId?: string;
    message: string;
  }) => {
    setUploadFeedback({ type: 'success', message });
    setFailedResumeId(null);

    // Defer parent state update to avoid setState during render
    setTimeout(() => {
      onUploadComplete?.(resumeId);
    }, 0);

    // Close dialog after a short delay to show success state
    setTimeout(() => {
      setIsOpen(false);
      setUploadFeedback(null);
      setFailedResumeId(null);
      if (fileId) {
        removeFile(fileId); // Clear file for next time
      }
    }, 1500);
  };

  const [
    { files, isDragging, errors, isUploadingGlobal },
    {
      getInputProps,
      openFileDialog,
      removeFile,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
    },
  ] = useFileUpload({
    maxSize: MAX_FILE_SIZE,
    accept: ACCEPTED_FILE_TYPES.join(','),
    multiple: false,
    uploadUrl: UPLOAD_URL,
    onUploadSuccess: (uploadedFile, response) => {
      const data = response as {
        resume_id?: string;
        processing_status?: 'pending' | 'processing' | 'ready' | 'failed';
        is_master?: boolean;
      };
      if (data.resume_id) {
        const processingFailed = data.processing_status === 'failed';
        const successMessage = data.is_master
          ? t('dashboard.uploadDialog.successMaster')
          : t('dashboard.uploadDialog.success');
        if (processingFailed) {
          // Keep dialog open on failure so users can retry processing.
          setUploadFeedback({
            type: 'error',
            message: t('dashboard.uploadDialog.parsingFailedKeepOpen'),
          });
          setFailedResumeId(data.resume_id);
          return;
        }
        handleUploadSuccess({
          resumeId: data.resume_id,
          fileId: uploadedFile.id,
          message: successMessage,
        });
      } else {
        setFailedResumeId(null);
        setUploadFeedback({
          type: 'error',
          message: t('dashboard.uploadDialog.successMissingId'),
        });
      }
    },
    onUploadError: (file, errorMsg) => {
      setFailedResumeId(null);
      setUploadFeedback({
        type: 'error',
        message: errorMsg || t('dashboard.uploadDialog.failed'),
      });
    },
    onFilesChange: (currentFiles) => {
      if (currentFiles.length === 0) {
        setUploadFeedback(null);
        setFailedResumeId(null);
      }
    },
  });

  const currentFile = files[0];
  const displayErrors = uploadFeedback?.type === 'error' ? [uploadFeedback.message] : errors;
  const preventDropzoneInteraction = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleRetryProcessing = async () => {
    if (!failedResumeId) return;
    const resumeIdToRetry = failedResumeId;
    const fileIdToRemove = currentFile?.id;
    setIsRetryingProcessing(true);
    try {
      const result = await retryProcessing(resumeIdToRetry);
      if (result.processing_status !== 'ready') {
        setUploadFeedback({ type: 'error', message: t('dashboard.retryFailed') });
        return;
      }

      handleUploadSuccess({
        resumeId: resumeIdToRetry,
        fileId: fileIdToRemove,
        message: t('dashboard.retrySuccess'),
      });
    } catch (err) {
      console.error('Retry processing failed:', err);
      setUploadFeedback({ type: 'error', message: t('dashboard.retryFailed') });
    } finally {
      setIsRetryingProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="rounded-lg border border-[#e6e3dc] shadow-sw-default hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-none transition-all">
            <UploadIcon className="w-4 h-4 mr-2" />
            {t('dashboard.uploadResume')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 border-b border-[#e6e3dc] bg-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary text-white flex items-center justify-center shrink-0">
              <UploadIcon className="w-5 h-5" />
            </div>
            <DialogTitle className="font-sans text-xl font-bold uppercase tracking-tight">
              {t('dashboard.uploadResume')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-6 bg-background">
          <div
            className={`
                            relative border-2 border-dashed rounded-2xl p-6 text-center transition-all duration-200
                            ${
                              isDragging
                                ? 'border-primary bg-primary/5'
                                : 'border-steel-grey hover:border-primary hover:bg-primary/[0.03]'
                            }
                            ${currentFile ? 'bg-white border-solid border-primary/40' : ''}
                            ${!currentFile && !isRetryingProcessing ? 'cursor-pointer' : 'cursor-default'}
                            ${isRetryingProcessing ? 'opacity-60' : ''}
                        `}
            onClick={!currentFile && !isRetryingProcessing ? openFileDialog : undefined}
            onDragEnter={isRetryingProcessing ? preventDropzoneInteraction : handleDragEnter}
            onDragLeave={isRetryingProcessing ? preventDropzoneInteraction : handleDragLeave}
            onDragOver={isRetryingProcessing ? preventDropzoneInteraction : handleDragOver}
            onDrop={isRetryingProcessing ? preventDropzoneInteraction : handleDrop}
          >
            <input {...getInputProps()} />

            {isUploadingGlobal ? (
              <div className="flex flex-col items-center py-5">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Loader2Icon className="w-6 h-6 animate-spin text-primary" />
                </div>
                <p className=" text-sm font-bold uppercase text-primary">{t('common.uploading')}</p>
                {currentFile && (
                  <p className="mt-1 text-xs text-steel-grey truncate max-w-[220px]">
                    {currentFile.file.name}
                  </p>
                )}
              </div>
            ) : currentFile ? (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-[#e6e3dc] bg-paper-tint px-4 py-3">
                <div className="flex items-center gap-3 text-left overflow-hidden min-w-0">
                  <div className="w-10 h-10 rounded-xl border border-[#e6e3dc] bg-white flex items-center justify-center shrink-0">
                    <FileIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{currentFile.file.name}</p>
                    <p className="text-xs text-steel-grey">{formatBytes(currentFile.file.size)}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isRetryingProcessing}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(currentFile.id);
                  }}
                  className="rounded-xl hover:bg-red-100 text-red-600 shrink-0"
                  aria-label={t('a11y.removeFile')}
                  title={t('a11y.removeFile')}
                >
                  <XIcon className="w-5 h-5" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center py-5">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <UploadIcon className="w-6 h-6 text-primary" />
                </div>
                <p className="font-bold text-lg mb-1">
                  {t('dashboard.uploadDialog.dropzoneTitle')}
                </p>
                <p className=" text-xs text-steel-grey uppercase">
                  {t('dashboard.uploadDialog.dropzoneSubtitle')}
                </p>
                <div className="mt-4 inline-flex items-center rounded-full border border-[#e6e3dc] bg-white px-3 py-1 text-[10px] uppercase tracking-widest text-steel-grey shadow-sw-xs">
                  PDF · DOC · DOCX
                </div>
              </div>
            )}
          </div>

          {/* Save-as-master toggle */}
          {!isUploadingGlobal && !currentFile && (
            <button
              type="button"
              role="switch"
              aria-checked={asMaster}
              onClick={() => setAsMaster((prev) => !prev)}
              className={cn(
                'mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all',
                asMaster
                  ? 'border-primary bg-primary/5'
                  : 'border-[#e6e3dc] bg-white hover:border-primary/50'
              )}
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold uppercase tracking-wider">
                  {t('dashboard.uploadDialog.saveAsMaster')}
                </span>
                <span className="mt-0.5 block text-xs text-steel-grey">
                  {t('dashboard.uploadDialog.saveAsMasterHint')}
                </span>
              </span>
              <span
                className={cn(
                  'relative inline-flex h-6 w-12 shrink-0 items-center rounded-full border transition-colors',
                  asMaster ? 'border-primary bg-primary' : 'border-[#c9c5bc] bg-paper-tint'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 rounded-full bg-white border border-[#c9c5bc] transition-transform duration-200',
                    asMaster ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </span>
            </button>
          )}

          {/* Feedback Messages */}
          {displayErrors.length > 0 && (
            <div className="mt-4 p-3 rounded-xl bg-[#fdf3f2] border border-red-200 flex items-start gap-2 text-red-700 text-sm">
              <AlertCircleIcon className="w-5 h-5 shrink-0" />
              <div>
                {displayErrors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            </div>
          )}

          {uploadFeedback?.type === 'success' && (
            <div className="mt-4 p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-2 text-green-700 text-sm font-bold">
              <CheckCircle2Icon className="w-5 h-5 shrink-0" />
              <p>{uploadFeedback.message}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#e6e3dc] bg-white flex justify-end gap-2 rounded-b-2xl">
          {uploadFeedback?.type === 'error' && failedResumeId && (
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={handleRetryProcessing}
              disabled={isRetryingProcessing}
            >
              {isRetryingProcessing
                ? t('dashboard.retryingProcessing')
                : t('dashboard.retryProcessing')}
            </Button>
          )}
          {uploadFeedback?.type === 'error' && files.length > 0 && (
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={isRetryingProcessing}
              onClick={() => {
                if (files[0]) removeFile(files[0].id);
                setUploadFeedback(null);
                setFailedResumeId(null);
              }}
            >
              {t('dashboard.uploadDialog.tryDifferentFile')}
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline" className="rounded-xl">
              {t('common.cancel')}
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
