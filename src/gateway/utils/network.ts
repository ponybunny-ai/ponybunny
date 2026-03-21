/**
 * Network utility functions for the Gateway layer.
 */

/**
 * Check if an address is a local/loopback address.
 * Handles IPv4, IPv6, and IPv4-mapped IPv6 variants.
 */
export function isLocalAddress(address: string): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address === 'localhost' ||
    address.startsWith('::ffff:127.')
  );
}
