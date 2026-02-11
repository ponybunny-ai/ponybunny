import { describe, it, expect, jest } from '@jest/globals';
import {
  getOSInfo,
  getCPUInfo,
  getMemoryInfo,
  getHardwareInfo,
  getNetworkInfo,
  getProcessInfo,
  getSystemInfo,
} from '../../src/gateway/system/system-info.js';

describe('SystemInfo', () => {
  describe('getOSInfo', () => {
    it('should return OS information', () => {
      const osInfo = getOSInfo();

      expect(osInfo).toHaveProperty('platform');
      expect(osInfo).toHaveProperty('type');
      expect(osInfo).toHaveProperty('release');
      expect(osInfo).toHaveProperty('version');
      expect(osInfo).toHaveProperty('arch');
      expect(osInfo).toHaveProperty('hostname');
      expect(osInfo).toHaveProperty('uptime');

      expect(typeof osInfo.platform).toBe('string');
      expect(typeof osInfo.type).toBe('string');
      expect(typeof osInfo.uptime).toBe('number');
      expect(osInfo.uptime).toBeGreaterThan(0);
    });
  });

  describe('getCPUInfo', () => {
    it('should return CPU information', () => {
      const cpuInfo = getCPUInfo();

      expect(cpuInfo).toHaveProperty('model');
      expect(cpuInfo).toHaveProperty('cores');
      expect(cpuInfo).toHaveProperty('speed');
      expect(cpuInfo).toHaveProperty('usage');

      expect(typeof cpuInfo.model).toBe('string');
      expect(typeof cpuInfo.cores).toBe('number');
      expect(cpuInfo.cores).toBeGreaterThan(0);
      expect(typeof cpuInfo.speed).toBe('number');
      expect(cpuInfo.speed).toBeGreaterThan(0);

      if (cpuInfo.usage !== undefined) {
        expect(cpuInfo.usage).toBeGreaterThanOrEqual(0);
        expect(cpuInfo.usage).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('getMemoryInfo', () => {
    it('should return memory information', () => {
      const memInfo = getMemoryInfo();

      expect(memInfo).toHaveProperty('total');
      expect(memInfo).toHaveProperty('free');
      expect(memInfo).toHaveProperty('used');
      expect(memInfo).toHaveProperty('usagePercent');

      expect(memInfo.total).toBeGreaterThan(0);
      expect(memInfo.free).toBeGreaterThanOrEqual(0);
      expect(memInfo.used).toBeGreaterThanOrEqual(0);
      expect(memInfo.used).toBeLessThanOrEqual(memInfo.total);
      expect(memInfo.usagePercent).toBeGreaterThanOrEqual(0);
      expect(memInfo.usagePercent).toBeLessThanOrEqual(100);
    });
  });

  describe('getHardwareInfo', () => {
    it('should return hardware information', () => {
      const hwInfo = getHardwareInfo();

      expect(hwInfo).toHaveProperty('cpu');
      expect(hwInfo).toHaveProperty('memory');
      expect(hwInfo.cpu).toHaveProperty('model');
      expect(hwInfo.memory).toHaveProperty('total');
    });
  });

  describe('getNetworkInfo', () => {
    it('should return network interfaces information', () => {
      const netInfo = getNetworkInfo();

      expect(netInfo).toHaveProperty('interfaces');
      expect(Array.isArray(netInfo.interfaces)).toBe(true);

      if (netInfo.interfaces.length > 0) {
        const iface = netInfo.interfaces[0];
        expect(iface).toHaveProperty('name');
        expect(iface).toHaveProperty('address');
        expect(iface).toHaveProperty('family');
        expect(iface).toHaveProperty('internal');
        expect(['IPv4', 'IPv6']).toContain(iface.family);
        expect(typeof iface.internal).toBe('boolean');
      }
    });
  });

  describe('getProcessInfo', () => {
    it('should return current process information', () => {
      const procInfo = getProcessInfo();

      expect(procInfo).toHaveProperty('pid');
      expect(procInfo).toHaveProperty('uptime');
      expect(procInfo).toHaveProperty('memory');
      expect(procInfo).toHaveProperty('cpu');

      expect(procInfo.pid).toBe(process.pid);
      expect(procInfo.uptime).toBeGreaterThanOrEqual(0);

      expect(procInfo.memory).toHaveProperty('rss');
      expect(procInfo.memory).toHaveProperty('heapTotal');
      expect(procInfo.memory).toHaveProperty('heapUsed');
      expect(procInfo.memory).toHaveProperty('external');

      expect(procInfo.memory.rss).toBeGreaterThan(0);
      expect(procInfo.memory.heapTotal).toBeGreaterThan(0);
      expect(procInfo.memory.heapUsed).toBeGreaterThan(0);

      expect(procInfo.cpu).toHaveProperty('user');
      expect(procInfo.cpu).toHaveProperty('system');
      expect(procInfo.cpu.user).toBeGreaterThanOrEqual(0);
      expect(procInfo.cpu.system).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSystemInfo', () => {
    it('should return complete system information', () => {
      const sysInfo = getSystemInfo();

      expect(sysInfo).toHaveProperty('os');
      expect(sysInfo).toHaveProperty('hardware');
      expect(sysInfo).toHaveProperty('network');
      expect(sysInfo).toHaveProperty('process');

      expect(sysInfo.os).toHaveProperty('platform');
      expect(sysInfo.hardware).toHaveProperty('cpu');
      expect(sysInfo.hardware).toHaveProperty('memory');
      expect(sysInfo.network).toHaveProperty('interfaces');
      expect(sysInfo.process).toHaveProperty('pid');
    });
  });
});
