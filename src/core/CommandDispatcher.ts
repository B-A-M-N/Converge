import { Job, Actor } from '../types';
import { ControlPlane } from './ControlPlane';
import { JobRepository } from '../repositories/JobRepository';

export class CommandDispatcher {
  static async add(params: {
    task: string;
    interval: string;
    stopCondition?: any;
    cli: string;
    actor?: Actor;
  }): Promise<{ status: string; reason: string; jobId: string }> {
    const job = await ControlPlane.createJob({
      task: params.task,
      interval_spec: params.interval,
      stopCondition: params.stopCondition,
      cli: params.cli,
    }, params.actor ?? { actorId: 'cli' } as Actor);
    return { status: 'created', reason: 'Operator: add', jobId: job.id };
  }

  static async rm(jobId: string, actor?: Actor): Promise<{ status: string; reason: string; jobId: string }> {
    await ControlPlane.deleteJob(jobId, actor ?? { actorId: 'cli' } as Actor);
    return { status: 'deleted', reason: 'Operator: delete', jobId };
  }

  static async pause(jobId: string, actor?: Actor): Promise<{ status: string; reason: string; jobId: string }> {
    await ControlPlane.pauseJob(jobId, actor ?? { actorId: 'cli' } as Actor);
    return { status: 'paused', reason: 'Operator: pause', jobId };
  }

  static async resume(jobId: string, actor?: Actor): Promise<{ status: string; reason: string; jobId: string }> {
    await ControlPlane.resumeJob(jobId, actor ?? { actorId: 'cli' } as Actor);
    return { status: 'resumed', reason: 'Operator: resume', jobId };
  }

  static async runNow(jobId: string, actor?: Actor): Promise<any> {
    return ControlPlane.runNow(jobId, actor ?? { actorId: 'cli' } as Actor);
  }

  static ls(): Job[] {
    return JobRepository.list();
  }

  static logs(jobId: string): any[] {
    const { RunRepository } = require('../repositories/RunRepository');
    return RunRepository.getByJob(jobId);
  }

  static async doctor(): Promise<{
    status: string;
    findings: string[];
    overall: Record<string, any>;
  }> {
    const findings: string[] = [];
    const overall: Record<string, any> = {};

    try {
      const jobs = JobRepository.list();
      findings.push(`Database: ${jobs.length} job(s) registered`);
      overall.db = { jobs: jobs.length, ok: true };
    } catch (e: any) {
      findings.push(`Database error: ${e.message}`);
      overall.db = { ok: false, error: e.message };
    }

    const { listAdapters } = require('../adapters/registry');
    try {
      const list = listAdapters();
      findings.push(`Adapters: ${list.length} available (${list.join(', ')})`);
      overall.adapters = { ok: true, count: list.length, names: list };
    } catch {
      findings.push('Adapters: none loaded');
      overall.adapters = { ok: true, count: 0 };
    }

    return { status: 'ok', findings, overall };
  }

  static daemonLs(): Job[] {
    return JobRepository.list();
  }
}
