// Local display metadata never grants file access or changes a request binding.
export function transferPeerDisplay(record, role) {
  const clean = (value, limit) => String(value || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, limit).trim();
  const identity = record?.identity || {};
  const peerIdentity = { name: clean(identity.name, 12), avatar: clean(identity.avatar, 24) };
  const peerOrdinal = Number.isSafeInteger(record?.joinOrdinal) && record.joinOrdinal > 0 ? record.joinOrdinal : null;
  const kind = role === 'host' ? '客机' : '房主';
  const address = role === 'host' && peerOrdinal !== null ? kind + ' ' + peerOrdinal : kind;
  return { peerIdentity, peerOrdinal, peerLabel: peerIdentity.name ? peerIdentity.name + '（' + address + '）' : address };
}
