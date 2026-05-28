# 🛠️ DigitalOcean Droplet Maintenance & Operations Guide
## Environment: Ubuntu | 2GB RAM | Easypanel | PostgreSQL

Running a production application stack (Next.js CRM app, PostgreSQL database, and Easypanel orchestration) on a **2GB RAM / 1 vCPU DigitalOcean Droplet** requires strict operational discipline. Because system resources are tightly constrained, memory leaks, unpruned Docker build caches, or unindexed database tables can easily cause out-of-memory (OOM) crashes or disk lockups.

This document outlines the essential maintenance tasks, scheduled routines, and troubleshooting commands required to keep the server running smoothly.

---

## 📅 Summary Operations Checklist

| Frequency | Task | Focus Area | Impact / Risk of Neglect |
| :--- | :--- | :--- | :--- |
| **Weekly** | Run Docker system prune | Storage | Disk full (100%), Postgres goes read-only or crashes |
| **Weekly** | Verify PostgreSQL backup health | Data Safety | Data loss in case of hardware failure/corruption |
| **Weekly** | Monitor memory & check for OOM events | Memory | Silent app crashes, database restarts |
| **Monthly** | Run Ubuntu package security updates | Security | Vulnerabilities in system dependencies |
| **Monthly** | Inspect database size & table bloat | Database | Slow query times, high disk read amplification |
| **Monthly** | Verify SSL certificates & renew logs | Connectivity | "Connection not secure" SSL expired errors |
| **As Needed**| Expand Swap Space / Adjust Swappiness | Performance | Next.js build crash (`Killed`) |

---

## 1. 🧠 Memory & Swap Management

Memory is the most critical resource on a 2GB droplet. If Postgres and Next.js exceed physical memory, the Ubuntu kernel's Out-Of-Memory (OOM) Killer will terminate process containers (often targeting PostgreSQL first because of its memory footprint).

### 🔍 Monitoring Memory
To inspect current physical RAM and swap usage, run:
```bash
free -h
```
To check system performance statistics and see if the system is swapping heavily (which degrades disk IO):
```bash
vmstat 1 5
```
*(Look at the `si` [swap-in] and `so` [swap-out] columns. If these are constantly non-zero, the droplet is running low on RAM).*

### 🛡️ Checking for OOM Kills
If your app or database goes down without explanation, check if the kernel killed it due to memory starvation:
```bash
dmesg -T | grep -i -E 'kill|oom'
# OR inspect system logs
grep -i 'killed process' /var/log/syslog
```

### ⚙️ Optimizing Swap Configuration (Recommended: 4GB Swap)
If you frequently experience OOM events during Next.js builds, double the swap size.
1. **Turn off active swap**:
   ```bash
   sudo swapoff -a
   ```
2. **Resize the swap file (create a 4GB file)**:
   ```bash
   sudo fallocate -l 4G /swapfile
   # If fallocate fails or is not supported:
   # sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
   ```
3. **Set permissions and activate**:
   ```bash
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```
4. **Verify persistent activation**:
   Ensure the following line is in `/etc/fstab`:
   ```text
   /swapfile none swap sw 0 0
   ```
5. **Adjust Swappiness**:
   For databases, a lower swappiness (e.g., `10` or `20`) is preferred to keep them in RAM, but for 2GB Droplets running builds, `30` to `60` helps protect the OS. Check current value:
   ```bash
   cat /proc/sys/vm/swappiness
   ```
   To temporarily set to `30`:
   ```bash
   sudo sysctl vm.swappiness=30
   ```
   To make it permanent, add or edit this line in `/etc/sysctl.conf`:
   ```text
   vm.swappiness = 30
   ```

---

## 2. 💾 Disk Space & Docker Cache Pruning

Easypanel runs application stacks using Docker. Every git push and build generates temporary images and layers. On a 2GB droplet (often with a 25GB-50GB SSD), **disk space can fill up in a matter of weeks.**

> [!WARNING]
> If disk space reaches 100%, PostgreSQL will fail to write WAL logs and shut down immediately to prevent corruption. Next.js builds will also fail during image export.

### 🔍 Checking Disk Space
```bash
# Check general partition sizes
df -h

# Check Docker space utilization
docker system df
```

### 🧹 Cleaning Docker Cache (Weekly Task)
Run this command to safely prune build caches, stopped containers, dangling images, and unused networks:
```bash
docker system prune -a --volumes -f
```
*Note: The `--volumes` flag will delete unused volumes. Make sure you don't have stopped databases with persistent volumes you care about. If in doubt, run without it:*
```bash
docker system prune -a -f
```

### ⏰ Automating the Prune via Cron
To ensure the server never fills up, create a weekly cron job.
1. Open the crontab editor:
   ```bash
   sudo crontab -e
   ```
2. Add this line to run the prune every Sunday at 3:00 AM:
   ```text
   0 3 * * 0 docker system prune -a -f --volumes > /var/log/docker_prune.log 2>&1
   ```

---

## 3. 🗄️ PostgreSQL Maintenance & Optimization

PostgreSQL stores your client database records, CRM state, and vector chunks. 

### 💾 Backup Verification (Crucial)
Easypanel has native support for backing up individual services (like PostgreSQL) to external S3-compatible storage (e.g., DigitalOcean Spaces, AWS S3, or Backblaze B2).
1. **Configure Backup in Easypanel**:
   - Go to your PostgreSQL service in the Easypanel Dashboard.
   - Select **Backups**.
   - Input your S3 credentials, bucket name, and frequency (daily recommended).
2. **Manual DB Backup Command**:
   If you need to make an ad-hoc backup before a migration or upgrade:
   ```bash
   # Get the container name of PostgreSQL (e.g. easypanel-postgres)
   docker ps | grep postgres
   
   # Backup to a SQL file on the host machine
   docker exec -t <postgres-container-name> pg_dumpall -U <db_user> > /home/ubuntu/backups/db_backup_$(date +%F).sql
   ```

### ⚙️ Setting PostgreSQL Resource Limits
By default, PostgreSQL will try to consume memory based on its configuration. In Easypanel:
1. Navigate to the **PostgreSQL service** settings.
2. Under **Resources**, configure a hard **Memory Limit** (e.g., `512MB` or `768MB`). This prevents a rogue query from ballooning Postgres memory usage and taking down the whole server.
3. Keep the Next.js app memory capped at `1024MB` in Easypanel to leave headroom for Ubuntu system processes.
4. **Internal Routing:** Ensure all applications (like Next.js or n8n) connect to the database internally using the database service name (e.g., `datalazo:5432`) instead of the droplet's public IP address. This bypasses the host UFW firewall and keeps all database traffic secure within the private Docker network.

### 🧹 Database Health & Bloat Monitoring
Since database rows are frequently inserted/deleted (especially audit tables or log tables), table bloat can degrade performance.
Connect to Postgres using `psql` (via the Easypanel terminal or local tool) and run:

**Check Database Size:**
```sql
SELECT pg_size_pretty(pg_database_size('postgres'));
```

**Check Table Sizes (ordered by size):**
```sql
SELECT
    relname AS "Table",
    pg_size_pretty(pg_total_relation_size(pg_class.oid)) AS "Size",
    pg_size_pretty(pg_total_relation_size(pg_class.oid) - pg_relation_size(pg_class.oid)) AS "Index Size"
FROM pg_class
LEFT JOIN pg_namespace ON (pg_namespace.oid = pg_class.relnamespace)
WHERE nspname = 'public' AND relkind = 'r'
ORDER BY pg_total_relation_size(pg_class.oid) DESC;
```

**Vacuuming Dead Tuples:**
Postgres auto-vacuum handles dead tuples automatically, but you can check if tables are being processed:
```sql
SELECT relname, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze 
FROM pg_stat_user_tables;
```
*If a high-write table has not been vacuumed in weeks, trigger a manual vacuum:*
```sql
VACUUM ANALYZE;
```

---

## 4. 🔒 Ubuntu OS Security & Updates

Keep the host operating system secure with updates, firewall rules, and SSH monitoring.

### 🔄 Installing System Updates (Monthly Task)
Only install security patches to maintain stability.
```bash
sudo apt update
# Install package upgrades safely
sudo apt upgrade -y
# Clean up obsolete packages
sudo apt autoremove -y
```
> [!IMPORTANT]
> If a kernel upgrade is installed, a reboot is required. Schedule reboots during off-peak hours (e.g., midnight):
> ```bash
> sudo reboot
> ```

### 🧱 Firewall (UFW) Health Check
Ensure only web traffic and SSH are exposed to the internet.
```bash
sudo ufw status verbose
```
It should say `Status: active` and only allow:
- `22/tcp` (SSH) — *Optionally restrict this to your specific IP address for maximum security.*
- `80/tcp` (HTTP)
- `443/tcp` (HTTPS)
- `3000/tcp` (Easypanel default dashboard port, if configured without a custom domain reverse proxy).

If UFW is inactive, enable it carefully:
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
# If you use Easypanel panel directly:
# sudo ufw allow 3000/tcp
sudo ufw enable
```

---

## 5. 🔌 Easypanel & Docker Logs Management

Docker logs can silently grow and fill your disk. Easypanel handles log configurations, but you should verify limits.

### 🧹 Limiting Docker Logs (One-Time Setup)
Ensure Docker doesn't keep infinite log history. Check daemon configuration in `/etc/docker/daemon.json`:
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```
If you edit this file, restart Docker to apply:
```bash
sudo systemctl restart docker
```

### 🔄 Upgrading Easypanel
Easypanel can be upgraded directly from the dashboard panel or by running:
```bash
docker pull easypanel/easypanel
docker restart easypanel
```

---

## 🚨 Emergency Runbook

### Scenario A: Website returns 502 Bad Gateway / Database Connection Failed
1. **SSH into the server** and check CPU/memory usage:
   ```bash
   top -o %MEM
   # or htop (if installed)
   ```
2. **Check if Postgres container is running**:
   ```bash
   docker ps | grep postgres
   ```
3. **If Postgres is stopped**, check if it was killed by OOM:
   ```bash
   dmesg -T | grep -i oom
   ```
4. **Check logs of the database**:
   ```bash
   docker logs <postgres-container-name> --tail 50
   ```
5. **Restart database via Docker/Easypanel**:
   ```bash
   docker restart <postgres-container-name>
   ```

### Scenario B: Disk Space is at 100% (Droplet Locked)
1. **Find where space is spent**:
   ```bash
   sudo du -sh /* 2>/dev/null | sort -rh | head -n 10
   ```
2. **Run emergency Docker clean**:
   ```bash
   docker system prune -a -f --volumes
   ```
3. **Clear journal logs**:
   Systemd logs can grow large. Limit them to 100MB:
   ```bash
   sudo journalctl --vacuum-size=100M
   ```
4. **Truncate docker logs (if a container went wild)**:
   ```bash
   sudo sh -c 'truncate -s 0 /var/lib/docker/containers/*/*-json.log'
   ```
