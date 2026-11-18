resource "kubernetes_service_account_v1" "jenkins" {
  metadata {
    name      = "jenkins-deployer"
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels    = local.labels
  }
  automount_service_account_token = false
}

resource "kubernetes_role_v1" "jenkins" {
  metadata {
    name      = "jenkins-deployer"
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels    = local.labels
  }

  rule {
    api_groups     = ["apps"]
    resources      = ["deployments"]
    resource_names = [local.name]
    verbs          = ["get", "list", "watch", "patch"]
  }

  rule {
    api_groups     = [""]
    resources      = ["services"]
    resource_names = [local.name]
    verbs          = ["get"]
  }

  rule {
    api_groups = [""]
    resources  = ["pods"]
    verbs      = ["get", "list", "watch"]
  }

  rule {
    api_groups = [""]
    resources  = ["pods/portforward"]
    verbs      = ["get", "create"]
  }
}

resource "kubernetes_role_binding_v1" "jenkins" {
  metadata {
    name      = "jenkins-deployer"
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels    = local.labels
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role_v1.jenkins.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account_v1.jenkins.metadata[0].name
    namespace = kubernetes_namespace_v1.app.metadata[0].name
  }
}
