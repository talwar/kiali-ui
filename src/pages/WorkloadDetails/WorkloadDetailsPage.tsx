import * as React from 'react';
import { connect } from 'react-redux';
import { RouteComponentProps } from 'react-router-dom';
import { EmptyState, EmptyStateBody, EmptyStateVariant, Tab, Title } from '@patternfly/react-core';

import * as API from '../../services/Api';
import { Workload, WorkloadId } from '../../types/Workload';
import { ObjectCheck, Validations, ValidationTypes } from '../../types/IstioObjects';
import WorkloadInfo from './WorkloadInfo';
import * as AlertUtils from '../../utils/AlertUtils';
import IstioMetricsContainer from '../../components/Metrics/IstioMetrics';
import { MetricsObjectTypes } from '../../types/Metrics';
import CustomMetricsContainer from '../../components/Metrics/CustomMetrics';
import { RenderHeader } from '../../components/Nav/Page';
import { isIstioNamespace, serverConfig } from '../../config/ServerConfig';
import TrafficDetails from '../../components/Metrics/TrafficDetails';
import WorkloadPodLogs from './WorkloadInfo/WorkloadPodLogs';
import { DurationInSeconds } from '../../types/Common';
import { KialiAppState } from '../../store/Store';
import { durationSelector } from '../../store/Selectors';
import ParameterizedTabs, { activeTab } from '../../components/Tab/Tabs';

type WorkloadDetailsState = {
  workload?: Workload;
  validations?: Validations;
  currentTab: string;
};

type WorkloadDetailsPageProps = RouteComponentProps<WorkloadId> & {
  duration: DurationInSeconds;
};

const tabName = 'tab';
const defaultTab = 'info';

const paramToTab: { [key: string]: number } = {
  info: 0,
  traffic: 1,
  logs: 2,
  in_metrics: 3,
  out_metrics: 4
};

class WorkloadDetails extends React.Component<WorkloadDetailsPageProps, WorkloadDetailsState> {
  constructor(props: WorkloadDetailsPageProps) {
    super(props);
    this.state = { currentTab: activeTab(tabName, defaultTab) };
  }

  componentDidMount(): void {
    this.fetchWorkload();
  }

  componentDidUpdate(prevProps: WorkloadDetailsPageProps) {
    const aTab = activeTab(tabName, defaultTab);
    if (
      this.props.match.params.namespace !== prevProps.match.params.namespace ||
      this.props.match.params.workload !== prevProps.match.params.workload ||
      this.state.currentTab !== aTab ||
      this.props.duration !== prevProps.duration
    ) {
      this.setState({ currentTab: aTab });
      this.fetchWorkload();
    }
  }

  private fetchWorkload = () => {
    API.getWorkload(this.props.match.params.namespace, this.props.match.params.workload)
      .then(details =>
        this.setState({
          workload: details.data,
          validations: this.workloadValidations(details.data)
        })
      )
      .catch(error => AlertUtils.addError('Could not fetch Workload.', error));
  };

  // All information for validations is fetched in the workload, no need to add another call
  private workloadValidations(workload: Workload): Validations {
    const noIstiosidecar: ObjectCheck = {
      message: 'Pod has no Istio sidecar',
      severity: ValidationTypes.Warning,
      path: ''
    };
    const noAppLabel: ObjectCheck = { message: 'Pod has no app label', severity: ValidationTypes.Warning, path: '' };
    const noVersionLabel: ObjectCheck = {
      message: 'Pod has no version label',
      severity: ValidationTypes.Warning,
      path: ''
    };
    const pendingPod: ObjectCheck = { message: 'Pod is in Pending Phase', severity: ValidationTypes.Warning, path: '' };
    const unknownPod: ObjectCheck = { message: 'Pod is in Unknown Phase', severity: ValidationTypes.Warning, path: '' };
    const failedPod: ObjectCheck = { message: 'Pod is in Failed Phase', severity: ValidationTypes.Error, path: '' };

    const validations: Validations = {};
    if (workload.pods.length > 0) {
      validations.pod = {};
      workload.pods.forEach(pod => {
        validations.pod[pod.name] = {
          name: pod.name,
          objectType: 'pod',
          valid: true,
          checks: []
        };
        if (!isIstioNamespace(this.props.match.params.namespace)) {
          if (!pod.istioContainers || pod.istioContainers.length === 0) {
            validations.pod[pod.name].checks.push(noIstiosidecar);
          }
          if (!pod.labels) {
            validations.pod[pod.name].checks.push(noAppLabel);
            validations.pod[pod.name].checks.push(noVersionLabel);
          } else {
            if (!pod.appLabel) {
              validations.pod[pod.name].checks.push(noAppLabel);
            }
            if (!pod.versionLabel) {
              validations.pod[pod.name].checks.push(noVersionLabel);
            }
          }
        }
        switch (pod.status) {
          case 'Pending':
            validations.pod[pod.name].checks.push(pendingPod);
            break;
          case 'Unknown':
            validations.pod[pod.name].checks.push(unknownPod);
            break;
          case 'Failed':
            validations.pod[pod.name].checks.push(failedPod);
            break;
          default:
          // Pod healthy
        }
        validations.pod[pod.name].valid = validations.pod[pod.name].checks.length === 0;
      });
    }
    return validations;
  }

  private staticTabs() {
    const hasPods = this.state.workload?.pods.length;

    const overTab = (
      <Tab title="Overview" eventKey={0} key={'Overview'}>
        <WorkloadInfo
          workload={this.state.workload}
          namespace={this.props.match.params.namespace}
          duration={this.props.duration}
          onRefresh={this.fetchWorkload}
        />
      </Tab>
    );
    const trafficTab = (
      <Tab title="Traffic" eventKey={1} key={'Traffic'}>
        <TrafficDetails
          itemType={MetricsObjectTypes.WORKLOAD}
          namespace={this.props.match.params.namespace}
          workloadName={this.props.match.params.workload}
          duration={this.props.duration}
        />
      </Tab>
    );

    const logTab = (
      <Tab title="Logs" eventKey={2} key={'Logs'}>
        {hasPods ? (
          <WorkloadPodLogs namespace={this.props.match.params.namespace} pods={this.state.workload!.pods} />
        ) : (
          <EmptyState variant={EmptyStateVariant.full}>
            <Title headingLevel="h5" size="lg">
              No logs for Workload {this.props.match.params.workload}
            </Title>
            <EmptyStateBody>There are no logs to display because the workload has no pods.</EmptyStateBody>
          </EmptyState>
        )}
      </Tab>
    );

    const inTab = (
      <Tab title="Inbound Metrics" eventKey={3} key={'Inbound Metrics'}>
        <IstioMetricsContainer
          namespace={this.props.match.params.namespace}
          object={this.props.match.params.workload}
          objectType={MetricsObjectTypes.WORKLOAD}
          direction={'inbound'}
        />
      </Tab>
    );

    const outTab = (
      <Tab title="Outbound Metrics" eventKey={4} key={'Outbound Metrics'}>
        <IstioMetricsContainer
          namespace={this.props.match.params.namespace}
          object={this.props.match.params.workload}
          objectType={MetricsObjectTypes.WORKLOAD}
          direction={'outbound'}
        />
      </Tab>
    );

    return [overTab, trafficTab, logTab, inTab, outTab];
  }

  private runtimeTabs() {
    const staticTabsCount = 5;
    const tabs: JSX.Element[] = [];

    if (this.state.workload) {
      const app = this.state.workload.labels[serverConfig.istioLabels.appLabelName];
      const version = this.state.workload.labels[serverConfig.istioLabels.versionLabelName];
      const isLabeled = app && version;
      if (isLabeled) {
        let dynamicTabsCount: number = 0;
        this.state.workload.runtimes.forEach(runtime => {
          runtime.dashboardRefs.forEach(dashboard => {
            const tabKey = dynamicTabsCount + staticTabsCount;
            paramToTab[dashboard.template] = tabKey;
            const tab = (
              <Tab key={dashboard.template} title={dashboard.title} eventKey={tabKey}>
                <CustomMetricsContainer
                  namespace={this.props.match.params.namespace}
                  app={app}
                  version={version}
                  template={dashboard.template}
                />
              </Tab>
            );
            tabs.push(tab);
            dynamicTabsCount = dynamicTabsCount + 1;
          });
        });
      }
    }

    return tabs;
  }

  private renderTabs() {
    // PF4 Tabs doesn't support static tabs followed of an array of tabs created dynamically.
    return this.staticTabs().concat(this.runtimeTabs());
  }

  render() {
    return (
      <>
        <RenderHeader location={this.props.location}>
          {
            // This magic space will align details header width with Graph, List pages
          }
          <div style={{ paddingBottom: 14 }} />
        </RenderHeader>
        <ParameterizedTabs
          id="basic-tabs"
          onSelect={tabValue => {
            this.setState({ currentTab: tabValue });
          }}
          tabMap={paramToTab}
          tabName={tabName}
          defaultTab={defaultTab}
          activeTab={this.state.currentTab}
          mountOnEnter={true}
          unmountOnExit={true}
        >
          {this.renderTabs()}
        </ParameterizedTabs>
      </>
    );
  }
}

const mapStateToProps = (state: KialiAppState) => ({
  duration: durationSelector(state)
});

const WorkloadDetailsContainer = connect(mapStateToProps)(WorkloadDetails);

export default WorkloadDetailsContainer;
