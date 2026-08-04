const { execSync } = require('child_process');

function runCommand(command) {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, timeout: 10000 }).toString('utf8').trim();
  } catch (error) {
    if (error.stdout || error.stderr) {
      return `${error.stdout ? error.stdout.toString('utf8') : ''}${error.stderr ? error.stderr.toString('utf8') : ''}`.trim();
    }
    throw error;
  }
}

function parseJavaVersion(output) {
  if (!output || typeof output !== 'string') {
    return null;
  }

  const match = output.match(/(?:version\s*)?"?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[._-](\d+))?/i);
  if (!match) {
    return null;
  }

  let major = parseInt(match[1], 10);
  const minor = match[2] ? parseInt(match[2], 10) : 0;

  if (major === 1 && minor) {
    major = minor;
  }

  return major;
}

function fail(message) {
  console.error(`\n[android-verify-env] ERROR: ${message}\n`);
  process.exit(1);
}

console.log('[android-verify-env] Checking Java environment...');
const javaHome = process.env.JAVA_HOME || '';
let javaOutput;
let javacOutput;

try {
  javaOutput = runCommand('java -version 2>&1');
} catch {
  fail('Java is not installed or not available on PATH. Install a JDK 17+ and set JAVA_HOME.');
}

try {
  javacOutput = runCommand('javac -version 2>&1');
} catch {
  fail('Javac is not available. Ensure a JDK is installed and JAVA_HOME points to the JDK, not a JRE.');
}

const javaVersion = parseJavaVersion(javaOutput);
const javacVersion = parseJavaVersion(javacOutput);

if (!javaVersion || !javacVersion) {
  console.log(javaOutput);
  console.log(javacOutput);
  fail('Unable to parse Java or Javac version output. Ensure Java 17+ is installed.');
}

if (javaVersion < 17 || javacVersion < 17) {
  fail(`Java version ${javaVersion} / Javac version ${javacVersion} is unsupported. Install JDK 17 or later.`);
}

if (!javaHome) {
  console.warn('[android-verify-env] WARNING: JAVA_HOME is not set. Gradle may use a different JDK than expected.');
} else {
  console.log(`[android-verify-env] JAVA_HOME=${javaHome}`);
}

console.log(`[android-verify-env] java version ${javaVersion}`);
console.log(`[android-verify-env] javac version ${javacVersion}`);
console.log('[android-verify-env] Java environment is valid for Android Gradle builds.');
