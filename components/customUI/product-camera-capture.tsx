"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Camera, X, Loader2, AlertCircle, RefreshCw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
// Shared camera extracted from the existing Product bulk-edit page.
export function ProductCameraCapture({
  onCapture,
  onFallback,
  onClose,
  title = "Product Photo Camera",
}: {
  onCapture: (file: File) => void;
  onFallback: () => void;
  onClose: () => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const captureLock = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraStarting, setCameraStarting] = useState(true);
  const [cameraError, setCameraError] = useState("");

  function stopCamera() {
    generation.current++;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function startCamera(mode: "environment" | "user") {
    stopCamera();
    const request = generation.current;
    setCameraStarting(true);
    setCameraError("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("ဒီ browser မှာ live camera API မရှိပါ");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      if (!active.current || generation.current !== request) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      if (!active.current || generation.current !== request) return;
      setCameraError(
        window.isSecureContext
          ? "Camera permission ကို Allow လုပ်ပါ။ မရပါက Device Camera ကိုသုံးပါ။"
          : "Live camera အတွက် HTTPS လိုအပ်ပါသည်။ Device Camera ကိုသုံးနိုင်ပါသည်။",
      );
    } finally {
      if (active.current && generation.current === request) setCameraStarting(false);
    }
  }

  useEffect(() => {
    active.current = true;
    void startCamera(facingMode);
    return () => {
      active.current = false;
      stopCamera();
    };
    // facingMode ပြောင်းတိုင်း camera stream အသစ်စမည်။
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const hidden = () => {
      if (document.hidden) {
        stopCamera();
        onCloseRef.current();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("visibilitychange", hidden);
      previous?.focus();
    };
  }, []);
  function switchCamera() {
    setFacingMode((current) => (current === "environment" ? "user" : "environment"));
  }

  function takePhoto() {
    const video = videoRef.current;
    if (captureLock.current) return;

    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("Camera အဆင်သင့်မဖြစ်သေးပါ");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Photo capture မလုပ်နိုင်ပါ");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const request = generation.current;
    captureLock.current = true;
    setCapturing(true);
    canvas.toBlob(
      (blob) => {
        captureLock.current = false;
        if (!active.current || generation.current !== request) return;
        setCapturing(false);
        if (!blob) {
          setCameraError("Photo capture မလုပ်နိုင်ပါ");
          return;
        }

        const file = new File([blob], `product-camera-${Date.now()}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });

        stopCamera();
        onCapture(file);
      },
      "image/jpeg",
      0.9,
    );
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          stopCamera();
          onClose();
        }
        if (event.key === "Tab") {
          const controls = Array.from(
            rootRef.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) || [],
          );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="product-camera-screen fixed inset-0 z-[110] flex flex-col bg-black"
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white sm:px-6">
        <div>
          <div className="flex items-center gap-2 text-sm font-black">
            <Camera className="h-5 w-5 text-blue-400" />
            {title}
          </div>
          <p className="mt-1 text-xs text-white/60">iPad · Android · Windows tablet</p>
        </div>

        <button
          type="button"
          onClick={() => {
            stopCamera();
            onClose();
          }}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 hover:bg-white/20"
          aria-label="Close product camera"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={cn(
            "h-full w-full object-contain",
            facingMode === "user" && "-scale-x-100",
          )}
        />

        {cameraStarting ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white">
            <div className="text-center">
              <Loader2 className="mx-auto h-9 w-9 animate-spin text-blue-400" />
              <p className="mt-3 text-sm font-bold">Camera starting...</p>
            </div>
          </div>
        ) : null}

        {cameraError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-white">
            <div className="max-w-md text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
              <p className="mt-4 text-sm font-bold leading-6">{cameraError}</p>
              <button
                type="button"
                onClick={() => void startCamera(facingMode)}
                className="mt-4 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold"
              >
                <RefreshCw className="mr-2 inline h-4 w-4" />
                Try Again
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="grid grid-cols-3 items-center gap-3 border-t border-white/10 bg-black px-4 py-4 text-white sm:px-6">
        <button
          type="button"
          onClick={switchCamera}
          disabled={capturing}
          className="flex min-h-12 items-center justify-center rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-bold hover:bg-white/20"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Switch
        </button>

        <button
          type="button"
          onClick={takePhoto}
          disabled={cameraStarting || Boolean(cameraError) || capturing}
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-blue-600 shadow-[0_0_0_5px_rgba(255,255,255,0.2)] disabled:opacity-40"
          aria-label="Take product photo"
        >
          <Camera className="h-7 w-7" />
        </button>

        <button
          type="button"
          onClick={() => {
            stopCamera();
            onFallback();
          }}
          className="flex min-h-12 items-center justify-center rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-bold hover:bg-white/20"
        >
          <Upload className="mr-2 h-4 w-4" />
          Device
        </button>
      </footer>
    </motion.div>,
    document.body,
  );
}
