/**
 * useTerminalSize - Track terminal columns/rows and trigger rerender on resize
 */

import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export interface TerminalSize {
  columns: number;
  rows: number;
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

const resolveSize = (stdout: NodeJS.WriteStream): TerminalSize => ({
  columns: typeof stdout.columns === 'number' ? stdout.columns : DEFAULT_COLUMNS,
  rows: typeof stdout.rows === 'number' ? stdout.rows : DEFAULT_ROWS,
});

export const useTerminalSize = (): TerminalSize => {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => resolveSize(stdout));

  useEffect(() => {
    const handleResize = () => {
      setSize(resolveSize(stdout));
    };

    stdout.on('resize', handleResize);
    handleResize();

    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  return size;
};
