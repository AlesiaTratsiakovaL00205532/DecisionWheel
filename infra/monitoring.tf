locals {
  monitoring_name   = "decision-wheel-monitoring"
  monitoring_labels = { "app.kubernetes.io/name" = local.monitoring_name }
  monitoring_config = {
    "prometheus.yml" = yamlencode({
      global     = { scrape_interval = "5s", evaluation_interval = "5s" }
      rule_files = ["/etc/prometheus/alerts.yml"]
      alerting = {
        alertmanagers = [{ static_configs = [{ targets = ["127.0.0.1:9093"] }] }]
      }
      scrape_configs = [{
        job_name     = "decision-wheel"
        metrics_path = "/metrics"
        dns_sd_configs = [{
          names            = ["decision-wheel-metrics.decision-wheel.svc.cluster.local"]
          type             = "A"
          port             = 3000
          refresh_interval = "5s"
        }]
      }]
    })
    "alerts.yml" = yamlencode({
      groups = [{
        name = "decision-wheel"
        rules = [
          {
            alert       = "DecisionWheelTargetDown"
            expr        = "up{job=\"decision-wheel\"} == 0 or count(up{job=\"decision-wheel\"}) < 2 or absent(up{job=\"decision-wheel\"})"
            for         = "30s"
            labels      = { severity = "critical" }
            annotations = { summary = "A DecisionWheel metrics target is unavailable." }
          },
          {
            alert       = "DecisionWheelRequestErrors"
            expr        = "sum(increase(decision_wheel_http_errors_total{job=\"decision-wheel\",status=~\"4..|5..\"}[1m])) >= 5"
            for         = "15s"
            labels      = { severity = "warning" }
            annotations = { summary = "At least five client/server request errors occurred in one minute." }
          },
          {
            alert       = "DecisionWheelHighLatency"
            expr        = "histogram_quantile(0.95, sum by (le) (rate(decision_wheel_http_request_duration_seconds_bucket{job=\"decision-wheel\",route=\"/api/spin\"}[2m]))) > 0.5"
            for         = "1m"
            labels      = { severity = "warning" }
            annotations = { summary = "DecisionWheel API p95 latency exceeds 500 milliseconds." }
          }
        ]
      }]
    })
    "alertmanager.yml" = yamlencode({
      global = { resolve_timeout = "1m" }
      route = {
        receiver        = "local-ui"
        group_by        = ["alertname"]
        group_wait      = "5s"
        group_interval  = "10s"
        repeat_interval = "1h"
      }
      receivers = [{ name = "local-ui" }]
    })
    "grafana-datasources.yml" = yamlencode({
      apiVersion = 1
      datasources = [{
        name      = "DecisionWheel Prometheus"
        uid       = "decision-wheel-prometheus"
        type      = "prometheus"
        access    = "proxy"
        url       = "http://127.0.0.1:9090"
        isDefault = true
        editable  = false
      }]
    })
    "grafana-dashboards.yml" = yamlencode({
      apiVersion = 1
      providers = [{
        name                  = "DecisionWheel"
        type                  = "file"
        disableDeletion       = true
        allowUiUpdates        = false
        updateIntervalSeconds = 10
        options               = { path = "/var/lib/grafana/dashboards" }
      }]
    })
    "dashboard.json" = file("${path.module}/monitoring/dashboard.json")
  }
  monitoring_containers = {
    prometheus = {
      image = "prom/prometheus:v3.16.0@sha256:e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06"
      port  = 9090
      args  = ["--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.path=/prometheus", "--storage.tsdb.retention.time=6h", "--storage.tsdb.retention.size=128MB"]
      ready = "/-/ready"
      env   = {}
      mounts = [
        { name = "config", path = "/etc/prometheus", sub_path = null, read_only = true },
        { name = "prometheus-data", path = "/prometheus", sub_path = null, read_only = false }
      ]
      memory = "512Mi"
    }
    alertmanager = {
      image = "prom/alertmanager:v0.35.0@sha256:e638797febd034838eca8b98cdbd46f951e9bf7f178777aa8669167406a9946c"
      port  = 9093
      args  = ["--config.file=/etc/alertmanager/alertmanager.yml", "--storage.path=/alertmanager", "--cluster.listen-address="]
      ready = "/-/ready"
      env   = {}
      mounts = [
        { name = "config", path = "/etc/alertmanager", sub_path = null, read_only = true },
        { name = "alertmanager-data", path = "/alertmanager", sub_path = null, read_only = false }
      ]
      memory = "128Mi"
    }
    grafana = {
      image = "grafana/grafana:13.3.1@sha256:0615ec4fbd4072004b7d86b46ded63013a74b7d6eb1119273dd89e8fa25c13cf"
      port  = 3000
      args  = []
      ready = "/api/health"
      env = {
        GF_SECURITY_DISABLE_INITIAL_ADMIN_CREATION = "true"
        GF_AUTH_ANONYMOUS_ENABLED                  = "true"
        GF_AUTH_ANONYMOUS_ORG_ROLE                 = "Viewer"
        GF_AUTH_BASIC_ENABLED                      = "false"
        GF_AUTH_DISABLE_LOGIN_FORM                 = "true"
        GF_USERS_ALLOW_SIGN_UP                     = "false"
        GF_ANALYTICS_REPORTING_ENABLED             = "false"
        GF_ANALYTICS_CHECK_FOR_UPDATES             = "false"
        GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES      = "false"
        GF_NEWS_NEWS_FEED_ENABLED                  = "false"
        GF_PLUGINS_PREINSTALL_DISABLED             = "true"
        GF_LOG_MODE                                = "console"
      }
      mounts = [
        { name = "grafana-data", path = "/var/lib/grafana", sub_path = null, read_only = false },
        { name = "grafana-tmp", path = "/tmp", sub_path = null, read_only = false },
        { name = "config", path = "/etc/grafana/provisioning/datasources/datasource.yml", sub_path = "grafana-datasources.yml", read_only = true },
        { name = "config", path = "/etc/grafana/provisioning/dashboards/provider.yml", sub_path = "grafana-dashboards.yml", read_only = true },
        { name = "config", path = "/var/lib/grafana/dashboards/decision-wheel.json", sub_path = "dashboard.json", read_only = true }
      ]
      memory = "512Mi"
    }
  }
}

resource "kubernetes_namespace_v1" "monitoring" {
  metadata {
    name = local.monitoring_name
    labels = merge(local.monitoring_labels, {
      "pod-security.kubernetes.io/enforce"         = "restricted"
      "pod-security.kubernetes.io/enforce-version" = "v1.36"
    })
  }
}

resource "kubernetes_service_v1" "metrics" {
  metadata {
    name      = "decision-wheel-metrics"
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels    = local.labels
  }
  spec {
    cluster_ip                  = "None"
    publish_not_ready_addresses = true
    selector                    = local.labels
    port {
      name        = "metrics"
      port        = 3000
      target_port = "http"
    }
  }
}

resource "kubernetes_service_account_v1" "monitoring" {
  metadata {
    name      = local.monitoring_name
    namespace = kubernetes_namespace_v1.monitoring.metadata[0].name
  }
  automount_service_account_token = false
}

resource "kubernetes_config_map_v1" "monitoring" {
  metadata {
    name      = local.monitoring_name
    namespace = kubernetes_namespace_v1.monitoring.metadata[0].name
  }
  data = local.monitoring_config
}

resource "kubernetes_deployment_v1" "monitoring" {
  lifecycle {
    precondition {
      condition     = var.allow_local_monitoring_security_exception
      error_message = "The pinned monitoring images have documented HIGH vulnerabilities. Read the README and explicitly approve local-only use with allow_local_monitoring_security_exception; application CI gates must remain unchanged."
    }
  }

  metadata {
    name      = local.monitoring_name
    namespace = kubernetes_namespace_v1.monitoring.metadata[0].name
    labels    = local.monitoring_labels
  }
  spec {
    replicas = 1
    strategy {
      type = "Recreate"
    }
    selector {
      match_labels = local.monitoring_labels
    }
    template {
      metadata {
        labels = local.monitoring_labels
        annotations = {
          "config-checksum"                         = sha256(jsonencode(local.monitoring_config))
          "decision-wheel.local/security-exception" = "Owner-approved temporary local monitoring only; application CI gates unchanged."
        }
      }
      spec {
        service_account_name            = kubernetes_service_account_v1.monitoring.metadata[0].name
        automount_service_account_token = false
        security_context {
          run_as_non_root = true
          run_as_user     = 1000
          run_as_group    = 1000
          fs_group        = 1000
          seccomp_profile {
            type = "RuntimeDefault"
          }
        }
        dynamic "container" {
          for_each = local.monitoring_containers
          content {
            name              = container.key
            image             = container.value.image
            image_pull_policy = "IfNotPresent"
            args              = container.value.args
            port {
              name           = container.key
              container_port = container.value.port
            }
            dynamic "env" {
              for_each = container.value.env
              content {
                name  = env.key
                value = env.value
              }
            }
            dynamic "volume_mount" {
              for_each = container.value.mounts
              content {
                name       = volume_mount.value.name
                mount_path = volume_mount.value.path
                sub_path   = volume_mount.value.sub_path
                read_only  = volume_mount.value.read_only
              }
            }
            security_context {
              run_as_non_root            = true
              read_only_root_filesystem  = true
              allow_privilege_escalation = false
              capabilities {
                drop = ["ALL"]
              }
            }
            resources {
              requests = { cpu = "50m", memory = "64Mi" }
              limits   = { cpu = "500m", memory = container.value.memory }
            }
            startup_probe {
              http_get {
                path = container.value.ready
                port = container.key
              }
              period_seconds    = 5
              failure_threshold = 60
            }
            readiness_probe {
              http_get {
                path = container.value.ready
                port = container.key
              }
              period_seconds = 5
            }
            liveness_probe {
              http_get {
                path = container.value.ready
                port = container.key
              }
              period_seconds    = 10
              failure_threshold = 6
            }
          }
        }
        volume {
          name = "config"
          config_map {
            name = kubernetes_config_map_v1.monitoring.metadata[0].name
          }
        }
        dynamic "volume" {
          for_each = toset(["prometheus-data", "alertmanager-data", "grafana-data", "grafana-tmp"])
          content {
            name = volume.value
            empty_dir {
              size_limit = "512Mi"
            }
          }
        }
      }
    }
  }
  wait_for_rollout = true
}

resource "kubernetes_service_v1" "monitoring" {
  metadata {
    name      = local.monitoring_name
    namespace = kubernetes_namespace_v1.monitoring.metadata[0].name
  }
  spec {
    selector = local.monitoring_labels
    dynamic "port" {
      for_each = local.monitoring_containers
      content {
        name        = port.key
        port        = port.value.port
        target_port = port.key
      }
    }
  }
}
