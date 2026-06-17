// Sample DynamoDB CDK fixture for claude-db detection/parse tests.
// CDK is program source — claude-db parses best-effort (confidence: directional).
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DataStack extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Single-table design. partitionKey on a low-cardinality value risks a hot partition
    // (claude-db key-value/M16 should flag under high write rate — needs Tier-1/2 to confirm).
    const table = new dynamodb.Table(this, 'AppTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });
  }
}
