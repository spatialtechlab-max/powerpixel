"use client";

import { ShieldAlert } from "lucide-react";
import type { AIDetectionResult } from "@/lib/aiDetect";
import { AI_DETECTION_THRESHOLD } from "@/lib/aiDetect";

export function AIDetectionPanel({ result }: { result: AIDetectionResult }) {
  const scorePct = (result.classifierScore * 100).toFixed(1);
  const thresholdPct = (AI_DETECTION_THRESHOLD * 100).toFixed(0);

  return (
    <div className="mt-6 rounded-lg border border-danger/50 bg-danger/5 overflow-hidden">
      <div className="bg-danger/15 px-5 py-3 flex items-center gap-2 border-b border-danger/40">
        <ShieldAlert className="h-4 w-4 text-danger shrink-0" />
        <div className="text-[13px] font-semibold text-text-primary">
          Registration blocked. AI-generated work is not eligible.
        </div>
      </div>

      <div className="p-5 space-y-4">
        <p className="text-[13px] text-text-secondary leading-[1.65]">
          DoNotTrain registers original human-authored work. This file was
          flagged by our in-browser AI detector before it ever reached the
          chain. To preserve the integrity of the registry, AI-generated
          submissions are{" "}
          <span className="text-text-primary font-medium">not allowed</span>.
          Nothing was sent off your device. Both checks ran locally.
        </p>

        <dl className="grid sm:grid-cols-[170px_1fr] gap-y-2.5 gap-x-5 text-[12px]">
          <Row
            k="Pixel classifier"
            v={
              <span className="text-text-primary">
                <span className="mono">{scorePct}%</span> AI confidence
                {result.classifierLabel ? (
                  <span className="text-text-tertiary ml-2">
                    label <span className="mono">{result.classifierLabel}</span>
                  </span>
                ) : null}
                <span className="text-text-tertiary ml-2">
                  threshold <span className="mono">{thresholdPct}%</span>
                </span>
              </span>
            }
          />
          <Row
            k="Content Credentials"
            v={
              result.c2paFound ? (
                result.c2paClaimsAI ? (
                  <span className="text-text-primary">
                    Found, declares AI authorship
                    {result.c2paGenerator ? (
                      <span className="text-text-tertiary ml-2">
                        generator <span className="mono">{result.c2paGenerator}</span>
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-text-primary">
                    Found, no AI claim in manifest
                  </span>
                )
              ) : (
                <span className="text-text-primary">No manifest present</span>
              )
            }
          />
          {result.c2paDigitalSource ? (
            <Row
              k="Digital source"
              v={
                <span className="mono break-all text-text-primary">
                  {result.c2paDigitalSource}
                </span>
              }
            />
          ) : null}
        </dl>

        {result.reasons.length > 0 && (
          <div className="rounded-md border border-border bg-surface/60 p-4 space-y-2">
            <div className="text-[11px] mono uppercase tracking-[0.18em] text-text-tertiary">
              Why this was blocked
            </div>
            <ul className="text-[12px] text-text-secondary leading-[1.65] space-y-1.5 list-disc pl-4">
              {result.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-md border border-border bg-surface/60 p-4 space-y-2">
          <div className="text-[11px] mono uppercase tracking-[0.18em] text-text-tertiary">
            Think this is wrong?
          </div>
          <p className="text-[12px] text-text-secondary leading-[1.65]">
            No detector is perfect. Heavily edited or photo-realistic originals
            can occasionally be misclassified, especially if they were exported
            through an editing pipeline that smooths out sensor noise. If you
            are certain this is your original, human-authored work:
          </p>
          <ul className="text-[12px] text-text-secondary leading-[1.65] space-y-1 list-disc pl-4">
            <li>
              Re-export the file directly from your editor or camera without
              aggressive smoothing, denoising, or upscaling.
            </li>
            <li>
              Strip any leftover Content Credentials from earlier AI tools used
              in your workflow.
            </li>
            <li>
              For photographs, prefer the original capture (RAW or HEIF) over
              re-encoded JPEGs from social platforms.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-[10px] mono uppercase tracking-[0.15em] text-text-tertiary pt-0.5">
        {k}
      </dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}
