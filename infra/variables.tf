variable "kubeconfig_path" {
  description = "Private kubeconfig written by setup-kind.ps1, outside the repository."
  type        = string
  default     = "~\\.kube\\decision-wheel-kind-config"
}

variable "image" {
  description = "Local image tag loaded into kind; the deployment never pulls images."
  type        = string
  default     = "decision-wheel:remediation"

  validation {
    condition     = length(trimspace(var.image)) > 0
    error_message = "Supply the local application image loaded into kind."
  }
}
