const Contacts = {
  list: [],
  currentPin: null,

  async init() {
    this.list = await Storage.getAll('contacts');
    this.render();
  },

  render() {
    const el = document.getElementById('contacts-list');
    if (!this.list.length) {
      el.innerHTML = '<div class="empty-state"><svg><use href="#icon-contacts"/></svg><h3>No contacts</h3><p>Add contacts by their iNet PIN</p></div>';
      return;
    }
    el.innerHTML = '<div class="list">' + this.list.map(c => `
      <div class="list-item" onclick="Contacts.openProfile('${c.pin}')">
        <div class="list-item-avatar">${Utils.getInitials(c.name)}</div>
        <div class="list-item-info">
          <div class="list-item-title">${Utils.escapeHtml(c.name)}</div>
          <div class="list-item-subtitle">${c.pin}</div>
        </div>
      </div>
    `).join('') + '</div>';
  },

  search(query) {
    const q = query.toLowerCase();
    const items = document.querySelectorAll('#contacts-list .list-item');
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  },

  showAdd() {
    UI.showScreen('contact-add');
  },

  async add() {
    const pin = document.getElementById('add-contact-pin').value.trim();
    const name = document.getElementById('add-contact-name').value.trim();
    const bio = document.getElementById('add-contact-bio').value.trim();

    if (!pin || pin.length !== 6) { UI.toast('Enter a valid 6-digit PIN'); return; }
    if (!name) { UI.toast('Enter a name'); return; }
    if (this.list.find(c => c.pin === pin)) { UI.toast('Contact already exists'); return; }

    const contact = { pin, name, bio, addedAt: Date.now() };
    await Storage.set('contacts', contact);
    this.list.push(contact);
    this.render();
    UI.toast('Contact added');
    UI.goBack();

    document.getElementById('add-contact-pin').value = '';
    document.getElementById('add-contact-name').value = '';
    document.getElementById('add-contact-bio').value = '';
  },

  openProfile(pin) {
    const c = this.list.find(x => x.pin === pin);
    if (!c) return;
    this.currentPin = pin;
    document.getElementById('profile-avatar').textContent = Utils.getInitials(c.name);
    document.getElementById('profile-name').textContent = c.name;
    document.getElementById('profile-pin').textContent = c.pin;
    document.getElementById('profile-bio').textContent = c.bio || 'No bio';
    UI.showScreen('contact-profile');
  },

  showEdit() {
    const c = this.list.find(x => x.pin === this.currentPin);
    if (!c) return;
    UI.showModal('Edit Contact', `
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:6px;">Name</label>
        <input type="text" class="input" id="edit-contact-name" value="${Utils.escapeHtml(c.name)}">
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:6px;">Bio</label>
        <input type="text" class="input" id="edit-contact-bio" value="${Utils.escapeHtml(c.bio || '')}">
      </div>
    `, [
      { label: 'Save', class: 'primary', action: () => this.saveEdit() },
      { label: 'Cancel', class: 'secondary', action: () => UI.hideModal() }
    ]);
  },

  async saveEdit() {
    const name = document.getElementById('edit-contact-name').value.trim();
    const bio = document.getElementById('edit-contact-bio').value.trim();
    if (!name) return;
    const c = this.list.find(x => x.pin === this.currentPin);
    if (c) {
      c.name = name;
      c.bio = bio;
      await Storage.set('contacts', c);
      this.render();
      this.openProfile(this.currentPin);
      UI.hideModal();
      UI.toast('Contact updated');
    }
  },

  async deleteCurrent() {
    if (!confirm('Delete this contact?')) return;
    await Storage.delete('contacts', this.currentPin);
    this.list = this.list.filter(c => c.pin !== this.currentPin);
    this.render();
    UI.toast('Contact deleted');
    UI.goBack();
  },

  getName(pin) {
    const c = this.list.find(x => x.pin === pin);
    return c ? c.name : pin;
  },

  get(pin) {
    return this.list.find(x => x.pin === pin);
  }
};
