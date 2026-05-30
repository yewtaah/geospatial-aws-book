// Agents4Energy - Maintenance Agent (migrated)
import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib';
import { Stack, Fn, Aws, Token } from 'aws-cdk-lib';
import {
    aws_bedrock as bedrock,
    aws_iam as iam,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
    aws_rds as rds,
    aws_lambda as lambda,
    aws_ec2 as ec2,
    custom_resources as cr
} from 'aws-cdk-lib';
import { bedrock as cdkLabsBedrock } from '@cdklabs/generative-ai-cdk-constructs';
import path from 'path';
import { fileURLToPath } from 'url';

interface AgentProps {
    vpc: ec2.Vpc,
    s3Bucket: s3.IBucket,
    s3Deployment: cdk.aws_s3_deployment.BucketDeployment
}

export function maintenanceAgentBuilder(scope: Construct, props: AgentProps) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const stackName = cdk.Stack.of(scope).stackName;
    const stackUUID = cdk.Names.uniqueResourceName(scope, { maxLength: 3 }).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(-3);
    const defaultDatabaseName = 'maintdb';
    const foundationModel = 'anthropic.claude-3-sonnet-20240229-v1:0';
    const agentName = `A4E-Maintenance-${stackUUID}`;
    const agentRoleName = `AmazonBedrockExecutionRole_A4E_Maintenance-${stackUUID}`;
    const agentDescription = 'Agent for energy industry maintenance workflows';
    const knowledgeBaseName = `A4E-KB-Maintenance-${stackUUID}`;
    const postgresPort = 5432;
    const maxLength = 4096;

    console.log("Maintenance Stack UUID: ", stackUUID)

    const rootStack = cdk.Stack.of(scope).nestedStackParent
    if (!rootStack) throw new Error('Root stack not found')

    const maintTags = { Agent: 'Maintenance', Model: foundationModel }

    const bedrockAgentRole = new iam.Role(scope, 'BedrockAgentRole', {
        roleName: agentRoleName,
        assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
        description: 'IAM role for Maintenance Agent to access KBs and query CMMS',
    });

    const maintDb = new rds.DatabaseCluster(scope, 'MaintDB', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_16_4,
        }),
        defaultDatabaseName: defaultDatabaseName,
        enableDataApi: true,
        iamAuthentication: true,
        storageEncrypted: true,
        writer: rds.ClusterInstance.serverlessV2('writer'),
        serverlessV2MinCapacity: 0.5,
        serverlessV2MaxCapacity: 4,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        vpc: props.vpc,
        port: postgresPort,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    maintDb.secret?.addRotationSchedule('RotationSchedule', {
        hostedRotation: secretsmanager.HostedRotation.postgreSqlSingleUser({ functionName: `SecretRotationMaintDb-${stackUUID}` }),
        automaticallyAfter: cdk.Duration.days(30)
    });
    const writerNode = maintDb.node.findChild('writer').node.defaultChild as rds.CfnDBInstance

    maintDb.connections.securityGroups[0].addIngressRule(
        ec2.Peer.securityGroupId(props.vpc.vpcDefaultSecurityGroup),
        ec2.Port.tcp(postgresPort),
        'Allow inbound traffic from default SG'
    );

    const prepDbFunction = new lambda.Function(scope, `PrepDbFunction`, {
        description: 'Agents4Energy CMMS data population function - will reset data with each run',
        runtime: lambda.Runtime.NODEJS_LATEST,
        handler: 'index.handler',
        timeout: cdk.Duration.minutes(15),
        code: lambda.Code.fromAsset(path.join(__dirname, 'lambda')),
        environment: {
            MAINT_DB_CLUSTER_ARN: maintDb.clusterArn,
            MAINT_DB_SECRET_ARN: maintDb.secret!.secretArn,
            DEFAULT_DATABASE_NAME: defaultDatabaseName
        }
    });

    prepDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({ actions: ['rds-data:ExecuteStatement'], resources: [maintDb.clusterArn], }))
    prepDbFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: [maintDb.secret!.secretArn], }))

    const prepDb = new cr.AwsCustomResource(scope, `PrepDatabase`, {
        onCreate: {
            service: 'Lambda', action: 'invoke', parameters: { FunctionName: prepDbFunction.functionName, Payload: JSON.stringify({}) },
            physicalResourceId: cr.PhysicalResourceId.of('SqlExecutionResource'),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
            new iam.PolicyStatement({ actions: ['lambda:InvokeFunction'], resources: [prepDbFunction.functionArn], }),
        ]),
    });
    prepDb.node.addDependency(writerNode)

    const maintenanceKnowledgeBase = new cdkLabsBedrock.KnowledgeBase(scope, `KB-Maintenance`, {
        embeddingsModel: cdkLabsBedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction: `You are a helpful question answering assistant. You answer user questions factually and honestly related to industrial facility maintenance and operations`,
        description: 'Maintenance Knowledge Base',
    });

    maintenanceKnowledgeBase.addS3DataSource({ bucket: props.s3Bucket, dataSourceName: "a4e-kb-ds-s3-maint", inclusionPrefixes: ['maintenance-agent/'], })
    maintenanceKnowledgeBase.addWebCrawlerDataSource({ dataSourceName: "a4e-kb-ds-web", sourceUrls: ['https://novaoilfieldservices.com/learn/'], dataDeletionPolicy: cdkLabsBedrock.DataDeletionPolicy.RETAIN, chunkingStrategy: cdkLabsBedrock.ChunkingStrategy.HIERARCHICAL_TITAN })

    const lambdaFunction = new lambda.Function(scope, 'QueryCMMS', {
        description: 'Agents4Energy tools to query CMMS database',
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset('amplify/functions/text2SQL/'),
        handler: 'maintenanceAgentAG.lambda_handler',
        timeout: cdk.Duration.seconds(90),
        environment: { database_name: defaultDatabaseName, db_resource_arn: maintDb.clusterArn, db_credentials_secrets_arn: maintDb.secret!.secretArn }
    });
    lambdaFunction.node.addDependency(maintDb);
    const policyRDS = new iam.PolicyStatement({ actions: ["rds-data:ExecuteStatement", "rds-data:ExecuteSql","secretsmanager:GetSecretValue"], resources: [maintDb.clusterArn, maintDb.secret!.secretArn] });
    if (lambdaFunction.role) lambdaFunction.role.addToPrincipalPolicy(policyRDS);

    const agentMaint = new bedrock.CfnAgent(scope, 'MaintenanceAgent', {
        agentName: agentName,
        description: agentDescription,
        instruction: `You are an industrial maintenance specialist who has access to files and data about internal company operations.  To find information from the CMMS database, try using the action group tool to query the SQL database.`,
        foundationModel: foundationModel,
        autoPrepare: true,
        knowledgeBases: [{ description: 'Maintenance Knowledge Base', knowledgeBaseId: maintenanceKnowledgeBase.knowledgeBaseId, knowledgeBaseState: 'ENABLED' }],
        actionGroups: [{ actionGroupName: 'Query-CMMS-AG', actionGroupExecutor: { lambda: lambdaFunction.functionArn }, actionGroupState: 'ENABLED', description: 'Action group to perform SQL queries against CMMS database', functionSchema: { functions: [{ name: 'get_tables', description: 'get a list of usable tables from the database' }, { name: 'get_tables_information', description: 'get the column level details of a list of tables', parameters: { 'tables_list': { type: 'array', description: 'list of tables', required: true } } }, { name: 'execute_statement', description: 'Execute a SQL query against the CMMS databases', parameters: { 'sql_statement': { type: 'string', description: 'the SQL query to execute', required: true } } }] } }],
        agentResourceRoleArn: bedrockAgentRole.roleArn,
    });

    agentMaint.node.addDependency(maintenanceKnowledgeBase);

    lambdaFunction.addPermission('BedrockInvokePermission', { principal: new iam.ServicePrincipal('bedrock.amazonaws.com'), action: 'lambda:InvokeFunction', sourceArn: agentMaint.attrAgentArn, });

    const customAgentPolicy = new iam.Policy(scope, 'A4E-MaintAgentPolicy', { statements: [ new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [ `arn:aws:bedrock:${rootStack.region}:${rootStack.account}:inference-profile/*`, `arn:aws:bedrock:us-*::foundation-model/*` ] }), new iam.PolicyStatement({ actions: ['bedrock:Retrieve'], resources: [ maintenanceKnowledgeBase.knowledgeBaseArn ] }) ] });
    bedrockAgentRole.attachInlinePolicy(customAgentPolicy);

    cdk.Tags.of(scope).add('Agent', maintTags.Agent);
    cdk.Tags.of(scope).add('Model', maintTags.Model);

    new bedrock.CfnAgentAlias(scope, 'maintenance-agent-alias', { agentId: agentMaint.attrAgentId, agentAliasName: `agent-alias` });

    return { defaultDatabaseName: defaultDatabaseName, maintenanceAgent: agentMaint };
}
