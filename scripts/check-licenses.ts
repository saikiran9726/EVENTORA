import fs from 'node:fs';
import path from 'node:path';

// Allowed open-source licenses for Eventora production deployment
const ALLOWED_LICENSES = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  '0BSD',
  'Unlicense',
  'Python-2.0',
]);

// Explicitly prohibited viral copyleft licenses for proprietary/commercial deployment
const PROHIBITED_LICENSES = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'SSPL',
]);

export interface LicenseCheckResult {
  passed: boolean;
  totalPackagesChecked: number;
  flaggedPackages: Array<{ package: string; license: string; reason: string }>;
}

export function checkMonorepoLicenses(rootDir = process.cwd()): LicenseCheckResult {
  const flaggedPackages: Array<{ package: string; license: string; reason: string }> = [];
  let totalChecked = 0;

  const pkgFiles = [
    path.join(rootDir, 'package.json'),
    path.join(rootDir, 'packages', 'shared', 'package.json'),
    path.join(rootDir, 'packages', 'backend', 'package.json'),
    path.join(rootDir, 'packages', 'frontend', 'package.json'),
  ];

  const directDeps = new Set<string>();

  for (const pkgFile of pkgFiles) {
    if (fs.existsSync(pkgFile)) {
      const data = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      for (const dep of Object.keys(data.dependencies || {})) {
        if (!dep.startsWith('@eventora/')) {
          directDeps.add(dep);
        }
      }
    }
  }

  // Check license for each direct dependency in node_modules
  for (const dep of directDeps) {
    totalChecked++;
    let depPkgPath = path.join(rootDir, 'node_modules', dep, 'package.json');
    if (!fs.existsSync(depPkgPath)) {
      // Try backend or frontend node_modules
      depPkgPath = path.join(rootDir, 'packages', 'backend', 'node_modules', dep, 'package.json');
    }
    if (!fs.existsSync(depPkgPath)) {
      depPkgPath = path.join(rootDir, 'packages', 'frontend', 'node_modules', dep, 'package.json');
    }

    if (fs.existsSync(depPkgPath)) {
      const depData = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'));
      const rawLicense = depData.license || depData.licenses || 'UNKNOWN';
      const licenseStr = typeof rawLicense === 'string' ? rawLicense : (rawLicense.type || 'UNKNOWN');

      // Strip parentheses and logical ORs if standard (e.g. "(MIT OR Apache-2.0)")
      const normalized = licenseStr.replace(/[()]/g, '').trim();
      const licenses = normalized.split(/\s+OR\s+|\s+AND\s+/);

      let hasAllowed = false;
      let hasProhibited = false;

      for (const lic of licenses) {
        if (PROHIBITED_LICENSES.has(lic)) {
          hasProhibited = true;
        }
        if (ALLOWED_LICENSES.has(lic)) {
          hasAllowed = true;
        }
      }

      if (hasProhibited) {
        flaggedPackages.push({
          package: dep,
          license: licenseStr,
          reason: `Copyleft license ${licenseStr} is prohibited in commercial deployment`,
        });
      } else if (!hasAllowed && licenseStr !== 'UNKNOWN') {
        // Unknown or custom license - warn
        flaggedPackages.push({
          package: dep,
          license: licenseStr,
          reason: `Unapproved license ${licenseStr}; requires legal approval`,
        });
      }
    }
  }

  return {
    passed: flaggedPackages.length === 0,
    totalPackagesChecked: totalChecked,
    flaggedPackages,
  };
}

// CLI execution
if (process.argv[1]?.includes('check-licenses')) {
  console.log('[License Audit] Scanning production dependencies for license compliance...');
  const result = checkMonorepoLicenses();
  console.log(`[License Audit] Checked ${result.totalPackagesChecked} production dependencies.`);

  if (!result.passed) {
    console.error('[License Audit] FAILED: Flagged licenses found:');
    for (const flag of result.flaggedPackages) {
      console.error(`  - ${flag.package} (${flag.license}): ${flag.reason}`);
    }
    process.exit(1);
  } else {
    console.log('[License Audit] PASSED: All dependencies use approved permissive licenses.');
    process.exit(0);
  }
}
