'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  UploadIcon,
  Loader2Icon,
  FileIcon,
  XIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from 'lucide-react';
import { uploadResumesBatch, saveResumeAsMaster, deleteResume } from '@/lib/api/resume';
import type { BatchUploadResultItem } from '@/lib/api/resume';
import { cn } from '@/lib/utils';

interface BulkImportDialogProps {
  trigger?: React.ReactNode;
  onImportComplete?: () => void;
}

const ACCEPTED_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_FILES = 10;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function BulkImportDialog({
  trigger,
  onImportComplete,
}: BulkImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState<BatchUploadResultItem[] | null>(null);
  const [makingMaster, setMakingMaster] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setSelectedFiles((prev) => {
      const combined = [...prev, ...arr].slice(0, MAX_FILES);
      return combined;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    setIsUploading(true);
    try {
      const batchResults = await uploadResumesBatch(selectedFiles);
      setResults(batchResults);
      onImportComplete?.();
    } catch (err) {
      console.error('Batch upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleMakeMaster = async (resumeId: string) => {
    setMakingMaster(resumeId);
    try {
      await saveResumeAsMaster(resumeId);
      setResults((prev) =>
        prev?.map((r) =>
          r.resume_id === resumeId ? { ...r, processing_status: 'ready' as const } : r,
        ) ?? null,
      );
    } catch (err) {
      console.error('Failed to make master:', err);
    } finally {
      setMakingMaster(null);
    }
  };

  const handleRemove = async (resumeId: string) => {
    setRemovingId(resumeId);
    try {
      await deleteResume(resumeId);
      setResults((prev) => prev?.filter((r) => r.resume_id !== resumeId) ?? null);
      onImportComplete?.();
    } catch (err) {
      console.error('Failed to delete resume:', err);
    } finally {
      setRemovingId(null);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedFiles([]);
    setResults(null);
  };

  const hasErrors = results?.some((r) => r.error);
  const successCount = results?.filter((r) => !r.error).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-lg border border-[#e6e3dc] shadow-sw-default hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-none transition-all">
            <UploadIcon className="w-4 h-4 mr-2" />
            Import Resumes
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc] bg-white">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary text-white flex items-center justify-center shrink-0">
              <UploadIcon className="w-5 h-5" />
            </div>
            <DialogTitle className="font-sans text-xl font-bold uppercase tracking-tight">
              Import Resumes
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-6 bg-background">
          {!results ? (
            <div className="space-y-5">
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200',
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-steel-grey hover:border-primary hover:bg-primary/[0.03]',
                )}
              >
                <UploadIcon className="h-10 w-10 mx-auto mb-3 text-steel-grey" />
                <p className="text-sm font-medium text-ink">
                  Drag & drop PDF or DOCX files here
                </p>
                <p className="text-xs text-steel-grey mt-1.5">
                  or click to browse
                </p>
                <p className="text-xs text-steel-grey mt-3">
                  Max {MAX_FILES} files, {MAX_FILE_SIZE / (1024 * 1024)}MB each
                </p>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES.join(',')}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />

              {/* Selected files list */}
              {selectedFiles.length > 0 && (
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {selectedFiles.map((file, i) => (
                    <div
                      key={`${file.name}-${i}`}
                      className="flex items-center gap-3 text-sm p-3 rounded-xl bg-white border border-[#e6e3dc]"
                    >
                      <FileIcon className="h-4 w-4 shrink-0 text-steel-grey" />
                      <span className="flex-1 truncate text-ink">{file.name}</span>
                      <span className="text-xs text-steel-grey">
                        {formatBytes(file.size)}
                      </span>
                      <button
                        onClick={() => removeFile(i)}
                        className="text-steel-grey hover:text-foreground transition-colors"
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || isUploading}
                className="w-full rounded-lg"
              >
                {isUploading ? (
                  <>
                    <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <UploadIcon className="h-4 w-4 mr-2" />
                    Import {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Results summary */}
              <div
                className={cn(
                  'p-4 rounded-xl text-sm font-medium',
                  hasErrors
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200',
                )}
              >
                {successCount} of {results.length} imported successfully
                {hasErrors && ` (${results.length - successCount} failed)`}
              </div>

              {/* Per-file results */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {results.map((r) => (
                  <div
                    key={r.filename}
                    className="flex items-center gap-3 text-sm p-3 rounded-xl bg-white border border-[#e6e3dc]"
                  >
                    {r.error ? (
                      <AlertCircleIcon className="h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <CheckCircle2Icon className="h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    <span className="flex-1 truncate text-ink">{r.filename}</span>
                    {r.error ? (
                      <span className="text-xs text-steel-grey">{r.error}</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs rounded-lg"
                          disabled={makingMaster === r.resume_id || removingId === r.resume_id}
                          onClick={() => r.resume_id && handleMakeMaster(r.resume_id)}
                        >
                          {makingMaster === r.resume_id ? (
                            <Loader2Icon className="h-3 w-3 animate-spin" />
                          ) : (
                            'Make Master'
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={makingMaster === r.resume_id || removingId === r.resume_id}
                          onClick={() => r.resume_id && handleRemove(r.resume_id)}
                        >
                          {removingId === r.resume_id ? (
                            <Loader2Icon className="h-3 w-3 animate-spin" />
                          ) : (
                            'Remove'
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <Button onClick={handleClose} className="w-full rounded-lg" variant="outline">
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
