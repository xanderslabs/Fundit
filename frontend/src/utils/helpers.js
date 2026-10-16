export function shortenWalletAddress(address) {
  if (!address || address.length < 9) {
    return address;
  }

  return address.slice(0, 4) + "..." + address.slice(-3);
}
