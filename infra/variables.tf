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

variable "allow_local_monitoring_security_exception" {
  description = "Explicit local-only acceptance of the pinned monitoring images' documented HIGH findings. Not for shared or production environments."
  type        = bool
  default     = false
}
