terraform {
  required_version = ">= 1.7, < 2.0"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.5.0"
    }
  }
}

provider "kubernetes" {
  config_path    = pathexpand(var.kubeconfig_path)
  config_context = "kind-decision-wheel"
}

locals {
  name = "decision-wheel"
  labels = {
    "app.kubernetes.io/name" = local.name
  }
}

resource "kubernetes_namespace_v1" "app" {
  metadata {
    name = local.name
    labels = merge(local.labels, {
      "pod-security.kubernetes.io/enforce"         = "restricted"
      "pod-security.kubernetes.io/enforce-version" = "v1.36"
    })
  }
}

resource "kubernetes_service_account_v1" "app" {
  metadata {
    name      = local.name
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels    = local.labels
  }
  automount_service_account_token = false
}

resource "kubernetes_deployment_v1" "app" {
  metadata {
    name      = local.name
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels    = local.labels
  }

  spec {
    replicas = 2
    selector {
      match_labels = local.labels
    }
    strategy {
      type = "RollingUpdate"
      rolling_update {
        max_surge       = "1"
        max_unavailable = "0"
      }
    }
    template {
      metadata {
        labels = local.labels
      }
      spec {
        service_account_name            = kubernetes_service_account_v1.app.metadata[0].name
        automount_service_account_token = false

        security_context {
          run_as_non_root = true
          run_as_user     = 1000
          run_as_group    = 1000
          seccomp_profile {
            type = "RuntimeDefault"
          }
        }

        container {
          name              = local.name
          image             = var.image
          image_pull_policy = "Never"

          port {
            name           = "http"
            container_port = 3000
          }
          env {
            name  = "NODE_ENV"
            value = "production"
          }
          env {
            name  = "HOST"
            value = "0.0.0.0"
          }
          env {
            name  = "PORT"
            value = "3000"
          }
          security_context {
            allow_privilege_escalation = false
            read_only_root_filesystem  = true
            run_as_non_root            = true
            capabilities {
              drop = ["ALL"]
            }
          }
          resources {
            requests = {
              cpu    = "100m"
              memory = "64Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "128Mi"
            }
          }
          startup_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds    = 2
            timeout_seconds   = 2
            failure_threshold = 30
          }
          readiness_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds    = 5
            timeout_seconds   = 2
            failure_threshold = 3
          }
          liveness_probe {
            http_get {
              path = "/health"
              port = "http"
            }
            period_seconds    = 10
            timeout_seconds   = 2
            failure_threshold = 3
          }
        }
      }
    }
  }
  wait_for_rollout = true
}

resource "kubernetes_service_v1" "app" {
  metadata {
    name      = local.name
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels    = local.labels
  }
  spec {
    selector = local.labels
    type     = "ClusterIP"
    port {
      name        = "http"
      port        = 80
      target_port = "http"
    }
  }
}
