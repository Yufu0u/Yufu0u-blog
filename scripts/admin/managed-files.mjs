import { CONFIG_DOMAINS } from '../content/config-domains.mjs';

export const configFiles = new Set(CONFIG_DOMAINS.flatMap(domain => [`config/${domain.file}.yaml`, `config/${domain.file}.yml`]));
export const managedDocument = name => configFiles.has(name) || ['content/spec/about.md', 'config/footer.html', 'deployment.json'].includes(name);
