const Auth = {
  profile: null,

  async init() {
    await Storage.init();
    this.profile = await Storage.getProfile();
    if (this.profile && this.profile.pin && this.profile.deviceId) {
      const valid = await this.validate();
      if (valid) {
        await this.enterApp();
        return;
      }
    }
    UI.showScreen('auth');
  },

  async validate() {
    try {
      await API.simWhoami(this.profile.pin, this.profile.deviceId);
      return true;
    } catch (e) {
      return false;
    }
  },

  async createSIM() {
    UI.showScreen('auth-create');
    document.getElementById('create-sim-status').textContent = 'Contacting iNet servers...';
    try {
      const data = await API.simNew();
      this.profile = {
        pin: data.net_number,
        deviceId: data.device_id,
        vapidKey: data.vapid_public_key,
        createdAt: Date.now()
      };
      await Storage.saveProfile(this.profile);
      await this.registerFingerprint();
      document.getElementById('new-sim-pin').textContent = data.net_number;
      document.getElementById('create-sim-status').textContent = 'Your new iNet number';
      document.getElementById('new-sim-display').style.display = 'block';
    } catch (e) {
      document.getElementById('create-sim-status').textContent = 'Error: ' + e.message;
    }
  },

  async registerFingerprint() {
    try {
      const fp = await Utils.getDeviceFingerprint();
      await API.deviceRegister(this.profile.pin, this.profile.deviceId, fp);
    } catch (e) {
      console.error('Fingerprint registration failed:', e);
    }
  },

  downloadSIM() {
    if (!this.profile) return;
    const blob = new Blob([JSON.stringify(this.profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inet-${this.profile.pin}.sim.inet`;
    a.click();
    URL.revokeObjectURL(url);
  },

  showLoadSIM() {
    UI.showScreen('auth-load');
  },

  showFingerprint() {
    UI.showScreen('auth-fingerprint');
  },

  async fingerprintLogin() {
    try {
      const fp = await Utils.getDeviceFingerprint();
      const data = await API.deviceLookup(fp);
      if (data.net_number) {
        document.getElementById('load-sim-pin').value = data.net_number;
        await this.loadSIM();
      } else {
        UI.toast('No SIM found on this device');
      }
    } catch (e) {
      UI.toast('Device not recognized');
    }
  },

  async loadSIM() {
    const pin = document.getElementById('load-sim-pin').value.trim();
    if (!pin || pin.length !== 6) {
      UI.toast('Enter a valid 6-digit PIN');
      return;
    }
    try {
      const data = await API.simWhoami(pin, this.profile?.deviceId || 'unknown');
      // If whoami succeeds with unknown device, we need to activate
      if (data.active) {
        this.profile = {
          pin: data.net_number,
          deviceId: this.profile?.deviceId || crypto.randomUUID(),
          createdAt: Date.now()
        };
        await Storage.saveProfile(this.profile);
        await API.simActivate(pin, this.profile.deviceId);
        await this.registerFingerprint();
        await this.enterApp();
      }
    } catch (e) {
      // Try to activate with new device
      const deviceId = crypto.randomUUID();
      try {
        await API.simActivate(pin, deviceId);
        this.profile = { pin, deviceId, createdAt: Date.now() };
        await Storage.saveProfile(this.profile);
        await this.registerFingerprint();
        await this.enterApp();
      } catch (e2) {
        UI.toast('Invalid PIN or activation failed');
      }
    }
  },

  triggerFileLoad() {
    document.getElementById('sim-file-input').click();
  },

  async handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.pin && data.deviceId) {
        this.profile = data;
        await Storage.saveProfile(this.profile);
        await this.enterApp();
      } else {
        UI.toast('Invalid SIM file');
      }
    } catch (e) {
      UI.toast('Could not read SIM file');
    }
  },

  async enterApp() {
    if (!this.profile) return;
    UI.showScreen('chats');
    UI.showNav(true);
    await App.init();
  },

  getProfile() {
    return this.profile;
  }
};
