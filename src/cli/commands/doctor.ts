import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const doctorCommand = new Command('doctor')
  .description('Active environment probe (destructive checks)')
  .action(async () => {
    console.log('\n[DOCTOR] Active Environment Probe');
    console.log('─'.repeat(40));

    const result = await CommandDispatcher.doctor();

    console.log(`\nStatus: ${result.status}`);
    for (const finding of result.findings) {
      console.log(`  ${finding}`);
    }
    console.log();
  });
