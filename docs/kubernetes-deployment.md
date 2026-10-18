# Kubernetes deployment

The pipeline now tests a real, temporary Kubernetes deployment, publishes the platform image to GitHub Container Registry, and can deploy a successful release to your own cluster. A temporary CI cluster is removed after testing; it is not a hosted website.

## What is needed once

- A reachable Kubernetes cluster with a default storage class, enough capacity for PostgreSQL and the platform, and an installed Ingress controller.
- A hostname pointing to that controller and a valid TLS certificate in the `aegisdr` namespace, in a Secret named `aegisdr-tls`.
- Cluster credentials for GitHub Actions. For the generic workflow, `KUBE_CONFIG` is the complete kubeconfig text, not base64. Use namespace-scoped credentials, not a personal administrator kubeconfig. Rotate credentials before they expire. Provider-specific identity federation can replace this once the provider is selected.

No cluster, paid resources, domain, or certificate is created automatically by this repository.

## Connect your cluster

First check that `kubectl config current-context` names the intended cluster. Then run from the project folder with administrator setup access:

```powershell
python scripts/prepare-kubernetes.py
```

This creates namespace `aegisdr` and generates the API access code and database credentials. It preserves existing credentials on later runs. Values do not appear in logs. Provision the `aegisdr-tls` certificate through your existing certificate manager or upload your certificate and private key as a Kubernetes TLS Secret.

The published GHCR package must be public, or the namespace needs a registry pull Secret called `ghcr-pull` with `read:packages` access. The workflow publishes an image named `ghcr.io/aryangupta1112/aegisdr` after all checks pass. Check package visibility in GitHub's package settings before enabling deployment.

In GitHub **Settings → Environments**, create `production`. Add:

| Kind | Name | Value |
| --- | --- | --- |
| Environment secret | `KUBE_CONFIG` | Dedicated deployment kubeconfig; do not commit it |
| Environment variable | `APP_HOST` | Your hostname, without `https://` or a path |
| Environment variable | `INGRESS_CLASS` | Your installed controller's class; defaults to `nginx` |
| Repository variable | `KUBERNETES_DEPLOY_ENABLED` | `true`, after the above setup is complete |

The deploy identity needs get/list/watch/create/patch/update on Deployments, StatefulSets, Services, persistent volume claims and Ingresses in namespace `aegisdr`; get/list on ReplicaSets for rollback; and get on Secrets `aegisdr-credentials` and `aegisdr-tls`. Bootstrap and registry/certificate provisioning use separate administrator access. The cluster API must be reachable from the runner; private clusters need a runner with network access.

Push a change to `main`, or use **Actions → Local platform validation → Run workflow** for validation only. Automatic publishing and deployment happen on pushes to `main` after all four checks pass. Deployment is skipped until the repository enable variable is set.

## Open the dashboard

Visit `https://YOUR_HOST`. Local automatic login is disabled. Enter the API access code in **Connect your workspace**. On Windows you can copy it directly to your clipboard without printing it:

```powershell
$encodedCode = kubectl -n aegisdr get secret aegisdr-credentials -o jsonpath='{.data.api-token}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedCode)) | Set-Clipboard
Remove-Variable encodedCode
```

Treat this code as an administrator password. The app currently has a single operator access code, not separate user accounts. Manual token connections refresh through polling. Kubernetes failure drills remain disabled in this deployment; they require the separate isolated demo integration.

## What deploys

One platform replica serves the dashboard, API, scheduler and sequential worker. PostgreSQL runs in a StatefulSet. Each has its own 10 GiB persistent volume claim. The platform uses a `Recreate` strategy because metadata uses SQLite and the worker must remain single-instance. Brief downtime during updates is expected. Storage stays attached across pod replacement.

The workflow deploys an immutable image digest, validates manifests against the cluster, waits for PostgreSQL, waits for the platform, and checks the public HTTPS health endpoint. A failed platform rollout restores the previous Deployment revision when one exists. This does not roll back database data, certificate changes or storage; the first installation has no previous revision. Inspect a failed release before retrying.

For an explicit rollback:

```sh
kubectl -n aegisdr rollout undo deployment/aegisdr
kubectl -n aegisdr rollout status deployment/aegisdr --timeout=300s
```

This setup has persistent storage, but backup copies remain in the same cluster. Add independently stored off-cluster copies and a tested cluster-loss recovery procedure before relying on it for production disaster recovery. Prometheus/Grafana are currently tested by the Compose check; a cloud monitoring installation is not included here.

## Verification

On every CI run, a disposable kind cluster receives the actual cloud manifests, using the locally built image. Tests verify remote login is required, the compiled dashboard is served, PostgreSQL backups and checksum verification work, and a data-loss drill restores the original records. The test skips public Ingress routing; the actual deployment's HTTPS health check covers that connection.

Do not run the destructive recovery smoke test against a real workspace. It is intended for disposable CI deployments only. Do not delete namespace `aegisdr` or its volume claims to perform an update.
