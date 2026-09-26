let installPrompt: BeforeInstallPromptEvent | null = null;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (navigator.serviceWorker.controller) {
    let refreshed = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
  });
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
  }).catch((error) => console.warn("Flink offline shell could not start", error));
}

export async function installApp() {
  if (!installPrompt) {
    window.alert("To install Flink, use your browser’s Share or menu button, then choose Add to Home Screen or Install app.");
    return;
  }
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
}

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  }
}
