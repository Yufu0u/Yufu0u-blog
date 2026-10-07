import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_DEPLOYMENT_POLICY = Object.freeze({ autoDeploy: true, locked: false, reason: '' });
export function validateDeploymentPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['autoDeploy', 'locked', 'reason'].includes(key))
    || typeof value.autoDeploy !== 'boolean' || typeof value.locked !== 'boolean'
    || typeof value.reason !== 'string' || value.reason.length > 500) throw new Error('部署控制格式有误：需要 autoDeploy、locked 开关和最多 500 字的 reason。');
  return { autoDeploy: value.autoDeploy, locked: value.locked, reason: value.reason };
}
export async function readDeploymentPolicy(root) {
  try { return validateDeploymentPolicy(JSON.parse(await fs.readFile(path.join(root, 'deployment.json'), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return { ...DEFAULT_DEPLOYMENT_POLICY }; throw error; }
}
export function assertDeploymentAllowed(policy) {
  if (policy.locked || !policy.autoDeploy) throw new Error(`生产部署已${policy.locked ? '锁定' : '暂停'}。${policy.reason ? '原因：' + policy.reason : ''}请在本机后台部署管理中解除并同步。`);
}
