import { DaemonSupervisor } from '../../daemon/DaemonSupervisor';

export function handleDaemon(): void {
  console.log('Starting Converge daemon...');
  console.log(`PID: ${process.pid}`);
  const sock = process.env.CONVERGE_SOCKET_PATH || '/tmp/converge.sock';
  console.log(`Socket: ${sock}`);
  console.log('Press Ctrl+C to stop.\n');

  const supervisor = new DaemonSupervisor();
  supervisor.start();
}

import { Command } from 'commander';

export const daemonCommand = new Command('daemon')
  .description('Start the background daemon process')
  .action(async () => {
    await handleDaemon();
  });
