"""A run lock across processes, so two engine runs never interleave their stages.

An OS file lock (flock, or msvcrt on Windows) on <store>.lock. The operating system releases it when the
holding process exits or dies, so a crashed run never leaves a stale lock and nothing has to expire.
The file also records who holds it, for the error a second run reports. Reads (summary, show) need no lock:
SQLite's WAL mode lets them run during a write.
"""
import json,os,socket,time
from datetime import datetime,timezone
from pathlib import Path
try:
    import fcntl
except ImportError:  # Windows
    fcntl=None
    import msvcrt
class LockBusy(RuntimeError):
    def __init__(self,path,holder):
        self.holder=holder
        super().__init__('another engine run holds %s: %s'%(path,json.dumps(holder) if holder else 'holder unknown'))
def _try(fd):
    try:
        if fcntl: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        else: msvcrt.locking(fd,msvcrt.LK_NBLCK,1)
        return True
    except OSError:
        return False
def _release(fd):
    if fcntl: fcntl.flock(fd,fcntl.LOCK_UN)
    else:
        os.lseek(fd,0,0)
        msvcrt.locking(fd,msvcrt.LK_UNLCK,1)
class RunLock:
    """with RunLock(store_path, purpose, wait_seconds): ... Raises LockBusy if not acquired within wait_seconds."""
    def __init__(self,store_path,purpose,wait_seconds=0,poll=0.2):
        self.path=Path(str(store_path)+'.lock')
        self.purpose,self.wait,self.poll=purpose,wait_seconds,poll
        self.fd=None
    def __enter__(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        fd=os.open(self.path,os.O_RDWR|os.O_CREAT,0o600)
        deadline=time.monotonic()+self.wait
        while not _try(fd):
            if time.monotonic()>=deadline:
                holder=self.holder()
                os.close(fd)
                raise LockBusy(self.path,holder)
            time.sleep(self.poll)
        self.fd=fd
        os.ftruncate(fd,0)
        os.lseek(fd,0,0)
        os.write(fd,json.dumps({'pid':os.getpid(),'host':socket.gethostname(),'purpose':self.purpose,
                                'since':datetime.now(timezone.utc).isoformat(timespec='seconds')}).encode())
        os.fsync(fd)
        return self
    def holder(self):
        try:
            text=self.path.read_text(encoding='utf-8').strip()
            return json.loads(text) if text else None
        except (OSError,ValueError):
            return None
    def __exit__(self,*exc):
        if self.fd is None: return
        os.ftruncate(self.fd,0)
        _release(self.fd)
        os.close(self.fd)
        self.fd=None
