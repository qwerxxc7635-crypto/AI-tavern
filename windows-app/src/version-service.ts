import { getVersion } from '@tauri-apps/api/app';

export interface VersionGateway {
  getVersion(): Promise<string>;
}

export const tauriVersionGateway: VersionGateway = Object.freeze({
  async getVersion() {
    const version = await getVersion();
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new TypeError('Application version is invalid');
    }
    return version;
  },
});
