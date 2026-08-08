export function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera permission was denied. Allow it in browser settings and try again.";
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "No compatible camera was found on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "The camera is busy or unavailable. Close other camera apps and try again.";
    }
  }
  return "The camera could not start. Check that another app is not using it, then retry.";
}
