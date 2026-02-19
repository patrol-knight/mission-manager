export {};

interface RuntimeConfig {
  ROSBRIDGE_URL: string;
}

declare global {
  interface Window {
    RUNTIME_CONFIG?: RuntimeConfig;
  }
}
