output "namespace" {
  value = kubernetes_namespace_v1.app.metadata[0].name
}

output "service_name" {
  value = kubernetes_service_v1.app.metadata[0].name
}

output "port_forward_command" {
  value = "kubectl --kubeconfig \"${pathexpand(var.kubeconfig_path)}\" --context kind-decision-wheel --namespace decision-wheel port-forward --address 127.0.0.1 service/decision-wheel 3002:80"
}

output "monitoring_port_forward_command" {
  value = "kubectl --kubeconfig \"${pathexpand(var.kubeconfig_path)}\" --context kind-decision-wheel --namespace decision-wheel-monitoring port-forward --address 127.0.0.1 service/decision-wheel-monitoring 3003:3000 9090:9090 9093:9093"
}
