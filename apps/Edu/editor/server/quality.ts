import {access, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {checkQuality} from '../src/domain/quality';
import type {Project, QualityReport} from '../src/shared/types';
import {safeChild, type ProjectStore} from './storage';

export async function projectQuality(store: ProjectStore, project: Project): Promise<QualityReport> {
  const report = checkQuality(project);
  const assetDirectory = store.assetsDirectory(project.id);
  for (const asset of project.assets) {
    try {
      const file = safeChild(assetDirectory, asset.fileName);
      await access(file);
      const info = await lstat(file);
      const actualDirectory = await realpath(assetDirectory);
      if (!info.isFile() || info.isSymbolicLink() || !(await realpath(file)).startsWith(`${actualDirectory}${path.sep}`)) throw new Error('unsafe asset');
    } catch {
      report.issues.push({id: `file-${asset.id}`, severity: 'error', code: 'asset-file-missing', message: `자료 파일을 찾을 수 없습니다: ${asset.name}`});
    }
  }
  report.summary.errors = report.issues.filter((issue) => issue.severity === 'error').length;
  report.summary.warnings = report.issues.filter((issue) => issue.severity === 'warning').length;
  report.ok = report.summary.errors === 0;
  return report;
}
