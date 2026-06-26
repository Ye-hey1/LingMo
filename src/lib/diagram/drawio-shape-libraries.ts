export interface DrawioShapeLibraryDoc {
  name: string
  title: string
  description: string
  prefix: string
  usage: string
  commonShapes: string[]
  notes?: string[]
}

const SHAPE_LIBRARIES: Record<string, DrawioShapeLibraryDoc> = {
  basic: {
    name: 'basic',
    title: 'Basic Shapes',
    description: 'General-purpose draw.io symbols such as callouts, stars, documents, clouds, and simple markers.',
    prefix: 'mxgraph.basic',
    usage: '<mxCell id="shape1" value="Label" style="shape=mxgraph.basic.document;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="100" height="70" as="geometry" /></mxCell>',
    commonShapes: [
      'document',
      'cloud_rect',
      'cloud_callout',
      'rectangular_callout',
      'rounded_rectangular_callout',
      'banner',
      'star',
      '8_point_star',
      'tick',
      'x',
      'no_symbol',
      'trapezoid',
      'parallelepiped',
      'octagon',
      'cone',
    ],
  },
  flowchart: {
    name: 'flowchart',
    title: 'Flowchart',
    description: 'Standard flowchart symbols for process diagrams, decisions, data, documents, and terminators.',
    prefix: 'mxgraph.flowchart',
    usage: '<mxCell id="decision1" value="Decision" style="shape=mxgraph.flowchart.decision;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="240" y="120" width="110" height="80" as="geometry" /></mxCell>',
    commonShapes: [
      'process',
      'decision',
      'terminator',
      'data',
      'database',
      'document',
      'multi-document',
      'manual_input',
      'predefined_process',
      'preparation',
      'delay',
      'display',
      'parallel_mode',
      'on-page_reference',
      'off-page_reference',
    ],
  },
  arrows2: {
    name: 'arrows2',
    title: 'Arrow Shapes',
    description: 'Decorative arrow vertices. For normal connectors, prefer mxCell edge elements with endArrow and explicit routing.',
    prefix: 'mxgraph.arrows2',
    usage: '<mxCell id="arrow1" value="" style="shape=mxgraph.arrows2.arrow;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="120" height="40" as="geometry" /></mxCell>',
    commonShapes: [
      'arrow',
      'leftArrow',
      'rightArrow',
      'upArrow',
      'downArrow',
      'quadArrow',
      'callout',
      'chevron',
    ],
    notes: ['Use edge mxCells for semantic graph connections; use arrows2 only when the arrow itself is a visual object.'],
  },
  aws4: {
    name: 'aws4',
    title: 'Amazon Web Services',
    description: 'AWS service icons for cloud architecture diagrams.',
    prefix: 'mxgraph.aws4',
    usage: '<mxCell id="lambda1" value="Lambda" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;verticalLabelPosition=bottom;verticalAlign=top;align=center;fillColor=#ED7100;strokeColor=#ffffff;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="70" height="70" as="geometry" /></mxCell>',
    commonShapes: [
      'api_gateway',
      'lambda',
      'lambda_function',
      'ec2',
      's3',
      'rds',
      'rds_instance',
      'dynamodb',
      'cloudfront',
      'elastic_load_balancing',
      'eks',
      'vpc',
      'group_vpc',
      'iam',
      'bedrock',
      'athena',
      'cloudwatch',
      'eventbridge',
    ],
    notes: ['Most AWS service icons use shape=mxgraph.aws4.resourceIcon plus resIcon=mxgraph.aws4.<shape>.'],
  },
  azure2: {
    name: 'azure2',
    title: 'Microsoft Azure',
    description: 'Azure SVG image icons grouped by category.',
    prefix: 'img/lib/azure2/',
    usage: '<mxCell id="vm1" value="VM" style="image;aspect=fixed;image=img/lib/azure2/compute/Virtual_Machine.svg;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="70" height="70" as="geometry" /></mxCell>',
    commonShapes: [
      'compute/Virtual_Machine.svg',
      'compute/Container_Instances.svg',
      'compute/Kubernetes_Services.svg',
      'compute/App_Services.svg',
      'databases/Azure_SQL.svg',
      'databases/Azure_Cosmos_DB.svg',
      'storage/Storage_Accounts.svg',
      'networking/Load_Balancers.svg',
      'networking/Application_Gateways.svg',
      'integration/API_Management_Services.svg',
      'ai_machine_learning/Azure_OpenAI.svg',
      'analytics/Azure_Synapse_Analytics.svg',
    ],
    notes: ['Azure icons use style="image;aspect=fixed;image=img/lib/azure2/<category>/<shape>.svg;...".'],
  },
  gcp2: {
    name: 'gcp2',
    title: 'Google Cloud Platform',
    description: 'GCP service icons for cloud architecture diagrams.',
    prefix: 'mxgraph.gcp2',
    usage: '<mxCell id="run1" value="Cloud Run" style="shape=mxgraph.gcp2.cloud_run;verticalLabelPosition=bottom;verticalAlign=top;align=center;fillColor=#4285F4;strokeColor=none;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="70" height="70" as="geometry" /></mxCell>',
    commonShapes: [
      'compute_engine',
      'cloud_run',
      'cloud_functions',
      'cloud_storage',
      'cloud_sql',
      'bigquery',
      'cloud_pubsub',
      'cloud_load_balancing',
      'cloud_dns',
      'cloud_armor',
      'cloud_iam',
      'cloud_firestore',
      'gke_on_prem',
      'cloud_bigtable',
    ],
  },
  kubernetes: {
    name: 'kubernetes',
    title: 'Kubernetes',
    description: 'Kubernetes resource icons for cluster and workload diagrams.',
    prefix: 'mxgraph.kubernetes',
    usage: '<mxCell id="pod1" value="Pod" style="shape=mxgraph.kubernetes.icon;prIcon=pod;verticalLabelPosition=bottom;verticalAlign=top;align=center;fillColor=#326CE5;strokeColor=none;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="70" height="70" as="geometry" /></mxCell>',
    commonShapes: [
      'pod',
      'deploy',
      'svc',
      'ing',
      'node',
      'ns',
      'secret',
      'cm',
      'job',
      'cronjob',
      'rs',
      'sts',
      'ds',
      'pv',
      'pvc',
      'hpa',
    ],
    notes: ['Kubernetes icons use shape=mxgraph.kubernetes.icon and prIcon=<shape>.'],
  },
  material_design: {
    name: 'material_design',
    title: 'Material Design Icons',
    description: 'General UI and product icons useful for app and system diagrams.',
    prefix: 'https://fonts.gstatic.com/s/i/materialicons/{icon_name}/v6/24px.svg',
    usage: '<mxCell id="user1" value="User" style="image;aspect=fixed;html=1;image=https://fonts.gstatic.com/s/i/materialicons/account_circle/v6/24px.svg;verticalLabelPosition=bottom;verticalAlign=top;align=center;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="48" height="48" as="geometry" /></mxCell>',
    commonShapes: [
      'account_circle',
      'account_box',
      'account_tree',
      'dashboard',
      'settings',
      'search',
      'manage_search',
      'security',
      'admin_panel_settings',
      'cloud_upload',
      'dns',
      'memory',
      'router',
      'code',
    ],
    notes: ['Material Design icons use image URLs. Replace {icon_name} with the icon name, e.g. account_circle or dashboard.'],
  },
}

export function listDrawioShapeLibraries(): DrawioShapeLibraryDoc[] {
  return Object.values(SHAPE_LIBRARIES)
}

export function getDrawioShapeLibrary(name: string): DrawioShapeLibraryDoc | null {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return SHAPE_LIBRARIES[normalized] || null
}

export function formatDrawioShapeLibraryDoc(library: DrawioShapeLibraryDoc): string {
  const lines = [
    `# ${library.title} (${library.name})`,
    '',
    library.description,
    '',
    `Prefix: \`${library.prefix}\``,
    '',
    'Usage:',
    '```xml',
    library.usage,
    '```',
    '',
    'Common shapes:',
    ...library.commonShapes.map((shape) => `- \`${shape}\``),
  ]

  if (library.notes?.length) {
    lines.push('', 'Notes:', ...library.notes.map((note) => `- ${note}`))
  }

  return lines.join('\n')
}
