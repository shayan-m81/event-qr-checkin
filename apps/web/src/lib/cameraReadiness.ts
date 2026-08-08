export type CameraReadinessState =
  | "READY"
  | "PERMISSION_REQUIRED"
  | "PERMISSION_DENIED"
  | "NO_CAMERA_FOUND"
  | "CAMERA_ERROR";

const CAMERA_SESSION_KEY = "party-camera-ready-v1";

function storedReady(): boolean {
  try { return sessionStorage.getItem(CAMERA_SESSION_KEY) === "ready"; } catch { return false; }
}

export async function currentCameraReadiness(): Promise<CameraReadinessState> {
  if (storedReady()) return "READY";
  if (!navigator.mediaDevices?.getUserMedia) return "NO_CAMERA_FOUND";
  try {
    const permission = await navigator.permissions?.query({ name: "camera" as PermissionName });
    return permission?.state === "denied" ? "PERMISSION_DENIED" : "PERMISSION_REQUIRED";
  } catch {
    return "PERMISSION_REQUIRED";
  }
}

export async function verifyCameraReadiness(): Promise<CameraReadinessState> {
  if (!navigator.mediaDevices?.getUserMedia) return "NO_CAMERA_FOUND";
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    if (stream.getVideoTracks().length === 0) return "NO_CAMERA_FOUND";
    if (navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices.some((device) => device.kind === "videoinput")) return "NO_CAMERA_FOUND";
    }
    try { sessionStorage.setItem(CAMERA_SESSION_KEY, "ready"); } catch { /* Session-only optimization. */ }
    return "READY";
  } catch (error) {
    if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
      return "PERMISSION_DENIED";
    }
    if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "OverconstrainedError")) {
      return "NO_CAMERA_FOUND";
    }
    return "CAMERA_ERROR";
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}
