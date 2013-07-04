import os

from fabric.api import env, execute, lcd, local, parallel, roles, task
from fabdeploytools.rpm import RPMBuild
import fabdeploytools.envs

import deploysettings as settings

env.key_filename = settings.SSH_KEY
fabdeploytools.envs.loadenv(os.path.join('/etc/deploytools/envs',
                                         settings.CLUSTER))
FIREPLACE = os.path.dirname(__file__)
ROOT = os.path.dirname(FIREPLACE)


@task
def pre_update(ref):
    with lcd(FIREPLACE):
        local('git fetch')
        local('git fetch -t')
        local('git reset --hard %s' % ref)


@task
def update():
    with lcd(FIREPLACE):
        local('npm install')
        local('make includes')


@task
@roles('web')
@parallel
def _install_package(rpmbuild):
    rpmbuild.install_package()


@task
def deploy():
    with lcd(FIREPLACE):
        ref = local('git rev-parse HEAD', capture=True)

    rpmbuild = RPMBuild(name='fireplace',
                        env=settings.ENV,
                        ref=ref,
                        cluster=settings.CLUSTER,
                        domain=settings.DOMAIN)
    rpmbuild.build_rpm(ROOT, ['fireplace'])

    execute(_install_package, rpmbuild)

    rpmbuild.clean()
