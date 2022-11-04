const execSync = require("child_process").execSync;
const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const spawnSync = require('child_process').spawnSync;

// test

function run(command) {
  console.log(command);
  let env = Object.assign({}, process.env);
  delete env.CI; // for Homebrew
  execSync(command, {stdio: 'inherit', env: env});
}

function runSafe() {
  const args = Array.from(arguments);
  console.log(args.join(' '));
  const command = args.shift();
  // spawn is safer and more lightweight than exec
  const ret = spawnSync(command, args, {stdio: 'inherit'});
  if (ret.status !== 0) {
    throw ret.error;
  }
}

function addToPath(newPath) {
  fs.appendFileSync(process.env.GITHUB_PATH, `${newPath}\n`);
}

const mariadbVersion = parseFloat(process.env['INPUT_MARIADB-VERSION'] || '10.8').toFixed(1);

if (!['10.8', '10.7', '10.6', '10.5', '10.4', '10.3'].includes(mariadbVersion)) {
  throw 'Invalid MariaDB version: ' + mariadbVersion;
}

const database = process.env['INPUT_DATABASE'];
const mariadbUser = process.env['INPUT_MARIADB-USER'];
const mariadbPassword = process.env['INPUT_MARIADB-PASSWORD'];

let bin;

if (process.platform == 'darwin') {
  // install
  run(`brew install mariadb@${mariadbVersion}`);

  // start
  bin = `/usr/local/opt/mariadb@${mariadbVersion}/bin`;
  run(`${bin}/mysql.server start`);

  addToPath(bin);

  // add permissions
  if (mariadbVersion == '10.3') {
    run(`${bin}/mysql -u root -e "GRANT ALL PRIVILEGES ON *.* TO ''@'localhost'"`);
    run(`${bin}/mysql -u root -e "FLUSH PRIVILEGES"`);
  }else if (mariadbUser !== undefined && mariadbPassword !== undefined){
    run(`${bin}/mysql -e "CREATE USER '`+mariadbUser+`'@'%' IDENTIFIED BY '`+mariadbPassword+`'"`);
    run(`${bin}/mysql -e "GRANT ALL PRIVILEGES ON *.* TO '`+mariadbUser+`'@'%'"`);
    run(`${bin}/mysql -e "FLUSH PRIVILEGES"`);
  }
} else if (process.platform == 'win32') {
  // install
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mariadb-'));
  process.chdir(tmpDir);
  const versionMap = {
    '10.8': '10.8.5',
    '10.7': '10.7.4',
    '10.6': '10.6.8',
    '10.5': '10.5.16',
    '10.4': '10.4.25',
    '10.3': '10.3.35'
  };
  const fullVersion = versionMap[mariadbVersion];
  run(`curl -Ls -o mariadb.msi https://downloads.mariadb.com/MariaDB/mariadb-${fullVersion}/winx64-packages/mariadb-${fullVersion}-winx64.msi`);
  run(`msiexec /i mariadb.msi SERVICENAME=MariaDB /qn`);

  bin = `C:\\Program Files\\MariaDB ${mariadbVersion}\\bin`;
  addToPath(bin);

  // add user
  run(`"${bin}\\mysql" -u root -e "CREATE USER 'runneradmin'@'localhost' IDENTIFIED BY ''"`);
  run(`"${bin}\\mysql" -u root -e "GRANT ALL PRIVILEGES ON *.* TO 'runneradmin'@'localhost'"`);
  run(`"${bin}\\mysql" -u root -e "FLUSH PRIVILEGES"`);
  
  // add base user
  if (mariadbUser !== undefined && mariadbPassword !== undefined){
    run(`"${bin}\\mysql" -u root -e "CREATE USER '`+mariadbUser+`'@'localhost' IDENTIFIED BY '`+mariadbPassword+`'"`);
    run(`"${bin}\\mysql" -u root -e "GRANT ALL PRIVILEGES ON *.* TO '`+mariadbUser+`'@'localhost'"`);
    run(`"${bin}\\mysql" -u root -e "FLUSH PRIVILEGES"`);
  }
  
} else {
  const image = process.env['ImageOS'];
  if (image == 'ubuntu20' || image == 'ubuntu22') {
    // clear previous data
    run(`sudo systemctl stop mysql.service`);
    run(`sudo rm -rf /var/lib/mysql/*`);
  }

  // install
  run(`sudo apt-key adv --recv-keys --keyserver hkp://keyserver.ubuntu.com:80 0xF1656F24C74CD1D8`);
  run(`echo "deb http://downloads.mariadb.com/MariaDB/mariadb-${mariadbVersion}/repo/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) main" | sudo tee /etc/apt/sources.list.d/mariadb.list`);
  run(`sudo apt-get update -o Dir::Etc::sourcelist="sources.list.d/mariadb.list" -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0"`);
  run(`sudo apt-get install mariadb-server-${mariadbVersion}`);

  // start
  run(`sudo systemctl unmask mariadb`);
  run(`sudo systemctl enable mariadb`);
  run(`sudo systemctl start mariadb`);

  // remove root password
  run(`sudo mysqladmin -proot password ''`);

  // add user
  run(`sudo mysql -e "CREATE USER '$USER'@'localhost' IDENTIFIED BY ''"`);
  run(`sudo mysql -e "GRANT ALL PRIVILEGES ON *.* TO '$USER'@'localhost'"`);
  run(`sudo mysql -e "FLUSH PRIVILEGES"`);


  // add defined user
  if (mariadbUser !== undefined && mariadbPassword !== undefined){
    run(`sudo mysql -e "CREATE USER '`+mariadbUser+`'@'%' IDENTIFIED BY '`+mariadbPassword+`'"`);
    run(`sudo mysql -e "GRANT ALL PRIVILEGES ON *.* TO '`+mariadbUser+`'@'%'"`);
    run(`sudo mysql -e "FLUSH PRIVILEGES"`);
  }
  
  bin = `/usr/bin`;
}

if (database) {
  runSafe(path.join(bin, 'mysqladmin'), 'create', database);
}
