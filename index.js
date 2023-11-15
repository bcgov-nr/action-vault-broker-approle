import {error, getInput, setFailed, setOutput} from '@actions/core'
import {context} from '@actions/github'
import axios from "axios";


const broker_jwt = getInput('broker_jwt');
const provision_role_id = getInput('provision_role_id');
const project_name = getInput('project_name');
const app_name = getInput('app_name');
const environment = getInput('environment');
const broker_url = getInput('broker_url');
const vault_addr = getInput('vault_addr');
const intention = (projectName, serviceName, environment, eventURL) => {
  return `{
    "event": {
      "provider": "github-action",
      "reason": "Job triggered",
      "url": "${eventURL}"
    },
    "actions": [
      {
        "action": "server-access",
        "id": "access",
        "provision": ["token/self"],
        "service": {
          "name": "${serviceName}",
          "project": "${projectName}",
          "environment":"${environment}"
        }
      }
    ],
    "user": {
      "name": "github@internal"
    }
  }`;
}

async function openBrokerIntention(intentionPayload) {
  try {
    console.info(`intentionPayload: ${intentionPayload}`);
    const intentionResponse = await axios.post(`${broker_url}/v1/intention/open`, intentionPayload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${broker_jwt}`
      }
    });
    if (intentionResponse.status !== 201) {
      setFailed(`intention call failed: ${intentionResponse.status}`);
    }
    const intentionToken = intentionResponse.data.token;
    const actionToken = intentionResponse.data.actions.access.token;
    return {intentionToken, actionToken};
  } catch (e) {
    setFailed(`intention call failed: ${e}`);
  }

}

async function getWrappedToken(actionToken) {
  try {
    const wrappedData = await axios.post(`${vault_addr}/v1/provision/token/self`, {}, {
      headers: {
        'x-broker-token': actionToken,
        'x-vault-role-id': provision_role_id
      }
    });
    if (wrappedData.status !== 201) {
      setFailed(`wrapped token call failed: ${wrappedData.status}`);
    }
    return wrappedData.data.wrap_info.token;
  } catch (e) {
    setFailed(`wrapped token call failed: ${e}`);
  }

}

async function getVaultToken(wrappedToken) {
  try {
    const vaultTokenResponse = await axios.post(`${vault_addr}/v1/sys/wrapping/unwrap`, undefined, {
      headers: {
        'x-vault-token': wrappedToken
      }
    });
    return vaultTokenResponse.data.auth.client_token;
  } catch (e) {
    setFailed(`vault token call failed: ${e}`);
  }
}

async function closeIntention(intentionToken) {
  try {
    await axios.post(`${broker_url}/v1/intention/close`, undefined, {
      headers: {
        'x-broker-token': intentionToken
      }
    });
  } catch (e) {
    setFailed(`intention close call failed: ${e}`);
  }
}
async function main() {
  if (!broker_jwt || broker_jwt === '') {
    setFailed('broker_jwt is required');
  }
  if (!provision_role_id || provision_role_id === '') {
    setFailed('provision_role_id is required');
  }
  if (!project_name || project_name === '') {
    setFailed('project_name is required');
  }
  if (!app_name || app_name === '') {
    setFailed('app_name is required');
  }
  if (!environment || environment === '' || !(environment === 'development' || environment === 'test' || environment === 'production')) {
    setFailed('environment is required and must be one of development, test or production');
  }
  if (!broker_url || broker_url === '') {
    setFailed('broker_url is required');
  }
  if (!vault_addr || vault_addr === '') {
    setFailed('vault_addr is required');
  }
  const intentionPayload = intention(project_name, app_name, environment, context.payload.repository.html_url);
  const {intentionToken, actionToken} = await openBrokerIntention(intentionPayload);
  if (!actionToken || !intentionToken) {
    setFailed(`intention call failed, no action token or intention token`);
  }
  const wrappedToken = await getWrappedToken(actionToken);
  if (!wrappedToken) {
    setFailed(`wrapped token call failed, no wrapped token`);
  }
  const vaultToken = await getVaultToken(wrappedToken);
  if (!vaultToken) {
    setFailed(`vault token call failed, no vault token`);
  }
  setOutput('vault_token', vaultToken);
  await closeIntention(intentionToken);

}

await main();


process.on('unhandledRejection', (reason, promise) => {
  let error = `Unhandled Rejection occurred. ${reason.stack}`
  console.error(error)
  setFailed(error)
});
