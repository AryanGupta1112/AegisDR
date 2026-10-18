# Run AegisDR on your computer with Kubernetes

Keep Docker Desktop running, then open PowerShell in the project folder:

```powershell
.\scripts\start-kubernetes.ps1
```

Open **http://127.0.0.1:8088**. The first run downloads kind (the local Kubernetes tool), creates a cluster, builds AegisDR, and starts the platform and PostgreSQL. Later runs reconnect to the existing deployment. No cloud account, domain, certificate, or manual access code is needed. The dashboard connection listens only on `127.0.0.1`.

This runs AegisDR **on Kubernetes**. Its database, backup files, settings, and history live in Kubernetes persistent storage. Try **My apps → Atlas Notes → Back up now**, then use **Practice recovery**. The separate Kubernetes pod/replica failure integration is not enabled by this launcher; those scenarios still use the optional isolated demo setup described in the main README.

After changing application code, rebuild and update the deployment:

```powershell
.\scripts\start-kubernetes.ps1 -Update
```

To close the dashboard connection:

```powershell
.\scripts\start-kubernetes.ps1 -Stop
```

That stops the connection only. To stop the whole local Kubernetes cluster, quit Docker Desktop after finishing any active backup or restore. Start Docker Desktop and run the launcher again when you return. Saved data remains as long as the cluster is retained.

Do not delete the `aegisdr-local` cluster, its Docker container, or its volume claims unless you intend to erase this Kubernetes workspace. Data from the earlier native and Docker Compose setups is separate and is not migrated automatically.

## Check the running services

```powershell
kubectl --kubeconfig .data/local-kubernetes/kubeconfig -n aegisdr get pods,pvc
```

You should see the `aegisdr` platform pod and `aegisdr-postgres-0` running, with both storage claims bound. The launcher keeps its cluster configuration and connection logs under ignored `.data/local-kubernetes`. It does not change your default Kubernetes context. If port `8088` is already occupied, stop the other AegisDR server first. After a deployment or pod restart, run the launcher again to reconnect.

Docker, kubectl, and a project Python environment with PyYAML are required. The launcher installs a checksum-verified, project-local kind binary on first use; no system-wide installation is required.
