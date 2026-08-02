type Level = 'info' | 'warn' | 'error';

function log(level: Level, scope: string, message: string, extra?: unknown) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}`;
  const args: unknown[] = extra === undefined ? [line] : [line, extra];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);
}

export function createLogger(scope: string) {
  return {
    info: (message: string, extra?: unknown) => log('info', scope, message, extra),
    warn: (message: string, extra?: unknown) => log('warn', scope, message, extra),
    error: (message: string, extra?: unknown) => log('error', scope, message, extra),
  };
}
